"use strict";
/*
 * GitHub as the store. Plain fetch against api.github.com, no SDK.
 *
 * Env: GITHUB_TOKEN (fine-grained, contents read/write on this repo only),
 *      GITHUB_REPO ("owner/name"), GITHUB_BRANCH (default "main").
 *
 * Reads use the Contents API. Writes go through the Git Data API so one UI
 * action is always one atomic commit:
 *   GET  /repos/{o}/{r}/git/ref/heads/{branch}        -> head commit sha
 *   GET  /repos/{o}/{r}/git/commits/{sha}             -> base tree sha
 *   POST /repos/{o}/{r}/git/blobs  {content, encoding:"base64"}
 *   POST /repos/{o}/{r}/git/trees  {base_tree, tree:[{path, mode, type, sha}]}
 *   POST /repos/{o}/{r}/git/commits {message, tree, parents:[head]}
 *   PATCH /repos/{o}/{r}/git/refs/heads/{branch} {sha}
 * Endpoints and encodings verified against the GitHub REST docs; see docs/UI.md.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function cfg() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  if (!repo || repo.indexOf("/") < 0) throw new Error("GITHUB_REPO must be owner/name");
  return { token, repo, branch };
}

function encodePath(p) {
  return String(p).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

class GitHubError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function request(method, path, opts) {
  opts = opts || {};
  const { token } = cfg();
  const headers = Object.assign({
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "oncogenik-ui"
  }, opts.headers || {});
  const init = { method, headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const r = await fetch(API + path, init);
  if (r.status === 404 && opts.allow404) return null;
  if (!r.ok) {
    let text = "";
    try { text = await r.text(); } catch (e) { /* ignore */ }
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) { /* not json */ }
    throw new GitHubError(r.status, "GitHub " + method + " " + path + " -> " + r.status + ": " + msg, text);
  }
  if (opts.raw) return Buffer.from(await r.arrayBuffer());
  if (r.status === 204) return null;
  return r.json();
}

function repoPath(suffix) {
  const { repo } = cfg();
  return "/repos/" + repo + suffix;
}

/* Reads */

// Text file -> { content, sha, size } or null when missing.
async function getFile(path) {
  const { branch } = cfg();
  const r = await request("GET", repoPath("/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(branch)), { allow404: true });
  if (!r || Array.isArray(r) || r.type !== "file") return null;
  let content;
  if (r.encoding === "base64" && typeof r.content === "string") {
    content = Buffer.from(r.content.replace(/\n/g, ""), "base64").toString("utf8");
  } else {
    // Files over 1 MB come back with an empty content field; read the blob raw.
    const buf = await getBlob(r.sha);
    content = buf ? buf.toString("utf8") : "";
  }
  return { content, sha: r.sha, size: r.size };
}

// Binary file -> Buffer or null. The raw media type streams the bytes directly
// and works for files between 1 MB and 100 MB as well.
async function getBinary(path) {
  const { branch } = cfg();
  const r = await request("GET", repoPath("/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(branch)), {
    allow404: true, raw: true, headers: { "Accept": "application/vnd.github.raw+json" }
  });
  return r === null ? null : r;
}

// Blob by sha -> Buffer or null.
async function getBlob(sha) {
  const r = await request("GET", repoPath("/git/blobs/" + sha), { allow404: true });
  if (!r) return null;
  return Buffer.from(String(r.content || "").replace(/\n/g, ""), r.encoding === "base64" ? "base64" : "utf8");
}

// Directory listing -> [{ name, path, type, size, sha }]. Empty when missing.
async function listDir(path) {
  const { branch } = cfg();
  const r = await request("GET", repoPath("/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(branch)), { allow404: true });
  if (!r) return [];
  if (!Array.isArray(r)) return [{ name: r.name, path: r.path, type: r.type, size: r.size, sha: r.sha }];
  return r.map(e => ({ name: e.name, path: e.path, type: e.type, size: e.size, sha: e.sha }));
}

// Whole branch tree, recursive -> { sha, truncated, entries: [{ path, type, size, sha }] }
async function getTree() {
  const { branch } = cfg();
  const r = await request("GET", repoPath("/git/trees/" + encodeURIComponent(branch) + "?recursive=1"));
  return {
    sha: r.sha,
    truncated: !!r.truncated,
    entries: (r.tree || []).map(e => ({ path: e.path, type: e.type, size: e.size, sha: e.sha, mode: e.mode }))
  };
}

/* Writes */

function toBase64(content) {
  if (Buffer.isBuffer(content)) return content.toString("base64");
  return Buffer.from(String(content), "utf8").toString("base64");
}

async function readHead() {
  const { branch } = cfg();
  const ref = await request("GET", repoPath("/git/ref/heads/" + encodePath(branch)));
  const head = ref.object.sha;
  const commit = await request("GET", repoPath("/git/commits/" + head));
  return { head, baseTree: commit.tree.sha };
}

/*
 * One atomic commit. files: [{ path, content (string | Buffer), mode? }],
 * deletes: [path]. Returns { sha, html_url }.
 * Retries once from a fresh ref read when the ref update hits a 409 or 422
 * (something else moved the branch between our read and our write).
 */
async function commitFiles(opts) {
  const { branch } = cfg();
  const message = opts && opts.message;
  const files = (opts && opts.files) || [];
  const deletes = (opts && opts.deletes) || [];
  if (!message) throw new Error("commit message required");
  if (!files.length && !deletes.length) throw new Error("nothing to commit");

  // Blobs are content-addressed, so they can be created once and reused on retry.
  const blobs = [];
  for (const f of files) {
    if (!f || !f.path) throw new Error("file entry needs a path");
    const b = await request("POST", repoPath("/git/blobs"), { body: { content: toBase64(f.content), encoding: "base64" } });
    blobs.push({ path: f.path, mode: f.mode || "100644", type: "blob", sha: b.sha });
  }
  const treeEntries = blobs.concat(deletes.map(p => ({ path: p, mode: "100644", type: "blob", sha: null })));

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { head, baseTree } = await readHead();
    const tree = await request("POST", repoPath("/git/trees"), { body: { base_tree: baseTree, tree: treeEntries } });
    const commit = await request("POST", repoPath("/git/commits"), { body: { message, tree: tree.sha, parents: [head] } });
    try {
      await request("PATCH", repoPath("/git/refs/heads/" + encodePath(branch)), { body: { sha: commit.sha, force: false } });
      return { sha: commit.sha, html_url: commit.html_url || null };
    } catch (e) {
      lastErr = e;
      if (!(e instanceof GitHubError) || (e.status !== 409 && e.status !== 422)) throw e;
    }
  }
  throw lastErr;
}

module.exports = { cfg, request, getFile, getBinary, getBlob, listDir, getTree, commitFiles, GitHubError, toBase64 };
