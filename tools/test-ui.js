"use strict";
// Tests for the UI's serverless side. No network: fetch and the GitHub module
// are mocked. Run with `node tools/test-ui.js`.
const assert = require("assert");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
process.env.GITHUB_TOKEN = "test-token";
process.env.GITHUB_REPO = "acme/oncogenik";
process.env.GITHUB_BRANCH = "main";

let n = 0;
async function t(name, fn) { await fn(); n++; console.log("ok " + name); }

// Mock req/res pair in the shape Vercel's Node runtime provides.
function mockReq(method, url, body) {
  const u = new URL(url, "http://localhost");
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  return { method, url, headers: {}, query, body };
}
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, headersSent: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b; res.headersSent = true; };
  res.json = () => res;
  return res;
}
function bodyJSON(res) { return JSON.parse(Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.body); }

// Route requires of ../_lib/session (and, later, github) to in-memory mocks so
// the handlers load even when the real session module is not in the tree.
const mocks = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (/_lib\/session$/.test(request)) return "mock:session";
  if (mocks.github && /_lib\/github$/.test(request)) return "mock:github";
  return origResolve.call(this, request, parent, isMain, options);
};
function installMock(id, exports) {
  const m = new Module(id, null);
  m.filename = id; m.loaded = true; m.exports = exports;
  require.cache[id] = m;
}
let sessionOK = true;
installMock("mock:session", {
  requireSession(req, res) {
    if (sessionOK) return { sub: "owner" };
    res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "unauthorized" }));
    return null;
  }
});

(async () => {

  /* ---------- github.commitFiles against a recorded fetch ---------- */

  await t("commitFiles makes one commit through the Git Data API", async () => {
    const gh = require(path.join(ROOT, "api/_lib/github.js"));
    const calls = [];
    let blobCount = 0;
    global.fetch = async (url, init) => {
      const u = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method: init.method, path: u.pathname, body, headers: init.headers });
      const reply = (status, json) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
      if (init.method === "GET" && u.pathname === "/repos/acme/oncogenik/git/ref/heads/main") return reply(200, { object: { sha: "HEAD1" } });
      if (init.method === "GET" && u.pathname === "/repos/acme/oncogenik/git/commits/HEAD1") return reply(200, { tree: { sha: "TREE0" } });
      if (init.method === "POST" && u.pathname === "/repos/acme/oncogenik/git/blobs") return reply(201, { sha: "BLOB" + (++blobCount) });
      if (init.method === "POST" && u.pathname === "/repos/acme/oncogenik/git/trees") return reply(201, { sha: "TREE1" });
      if (init.method === "POST" && u.pathname === "/repos/acme/oncogenik/git/commits") return reply(201, { sha: "COMMIT1", html_url: "https://github.com/acme/oncogenik/commit/COMMIT1" });
      if (init.method === "PATCH" && u.pathname === "/repos/acme/oncogenik/git/refs/heads/main") return reply(200, { object: { sha: body.sha } });
      return reply(404, { message: "no route " + init.method + " " + u.pathname });
    };

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const r = await gh.commitFiles({
      message: "ui(test): action",
      files: [{ path: "projects/t/project.json", content: "{\"a\":1}\n" }, { path: "projects/t/images/generated/01.png", content: png }],
      deletes: ["projects/t/old.md"]
    });
    assert.equal(r.sha, "COMMIT1");

    // Sequence: blobs first (reusable on retry), then ref, commit, tree, commit, ref update.
    const seq = calls.map(c => c.method + " " + c.path.replace("/repos/acme/oncogenik/", ""));
    assert.deepEqual(seq, [
      "POST git/blobs", "POST git/blobs",
      "GET git/ref/heads/main", "GET git/commits/HEAD1",
      "POST git/trees", "POST git/commits", "PATCH git/refs/heads/main"
    ]);
    // Blob content is base64 of the exact bytes, encoding declared.
    assert.deepEqual(calls[0].body, { content: Buffer.from("{\"a\":1}\n").toString("base64"), encoding: "base64" });
    assert.deepEqual(calls[1].body, { content: png.toString("base64"), encoding: "base64" });
    // Tree builds on the base tree and names every path with its blob sha; the delete carries sha null.
    const tree = calls[4].body;
    assert.equal(tree.base_tree, "TREE0");
    assert.deepEqual(tree.tree, [
      { path: "projects/t/project.json", mode: "100644", type: "blob", sha: "BLOB1" },
      { path: "projects/t/images/generated/01.png", mode: "100644", type: "blob", sha: "BLOB2" },
      { path: "projects/t/old.md", mode: "100644", type: "blob", sha: null }
    ]);
    assert.deepEqual(calls[5].body, { message: "ui(test): action", tree: "TREE1", parents: ["HEAD1"] });
    assert.deepEqual(calls[6].body, { sha: "COMMIT1", force: false });
    assert.equal(calls[0].headers.Authorization, "Bearer test-token");
    assert.equal(calls[0].headers["X-GitHub-Api-Version"], "2022-11-28");
  });

  await t("commitFiles retries once from a fresh ref on a 422 ref conflict", async () => {
    const gh = require(path.join(ROOT, "api/_lib/github.js"));
    const calls = [];
    let refReads = 0, patches = 0;
    global.fetch = async (url, init) => {
      const u = new URL(url);
      const p = u.pathname.replace("/repos/acme/oncogenik/", "");
      calls.push(init.method + " " + p);
      const reply = (status, json) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
      if (p === "git/ref/heads/main") return reply(200, { object: { sha: "HEAD" + (++refReads) } });
      if (p.startsWith("git/commits/HEAD")) return reply(200, { tree: { sha: "TREE_OF_" + p.slice(12) } });
      if (p === "git/blobs") return reply(201, { sha: "B" });
      if (p === "git/trees") return reply(201, { sha: "T" });
      if (p === "git/commits") return reply(201, { sha: "C" + refReads });
      if (p === "git/refs/heads/main") return ++patches === 1 ? reply(422, { message: "Update is not a fast forward" }) : reply(200, {});
      return reply(404, { message: "no" });
    };
    const r = await gh.commitFiles({ message: "m", files: [{ path: "a.txt", content: "x" }] });
    assert.equal(r.sha, "C2");
    assert.equal(refReads, 2);
    assert.equal(calls.filter(c => c === "POST git/blobs").length, 1, "blobs are not re-created");
    assert.equal(calls.filter(c => c === "POST git/trees").length, 2);
  });

  await t("commitFiles gives up after the second conflict and surfaces other errors at once", async () => {
    const gh = require(path.join(ROOT, "api/_lib/github.js"));
    let patches = 0;
    const mk = (status, json) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    global.fetch = async (url, init) => {
      const p = new URL(url).pathname.replace("/repos/acme/oncogenik/", "");
      if (p === "git/ref/heads/main") return mk(200, { object: { sha: "H" } });
      if (p === "git/commits/H") return mk(200, { tree: { sha: "T0" } });
      if (p === "git/blobs") return mk(201, { sha: "B" });
      if (p === "git/trees") return mk(201, { sha: "T" });
      if (p === "git/commits") return mk(201, { sha: "C" });
      if (p === "git/refs/heads/main") { patches++; return mk(409, { message: "conflict" }); }
      return mk(404, { message: "no" });
    };
    await assert.rejects(gh.commitFiles({ message: "m", files: [{ path: "a", content: "x" }] }), /409/);
    assert.equal(patches, 2);
    global.fetch = async () => mk(403, { message: "Resource not accessible by integration" });
    await assert.rejects(gh.commitFiles({ message: "m", files: [{ path: "a", content: "x" }] }), /403/);
  });

  await t("getFile decodes base64 content and returns null on 404", async () => {
    const gh = require(path.join(ROOT, "api/_lib/github.js"));
    global.fetch = async (url, init) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get("ref"), "main");
      if (u.pathname.endsWith("/contents/projects/t/project.json")) {
        return { ok: true, status: 200, json: async () => ({ type: "file", sha: "S", size: 7, encoding: "base64", content: Buffer.from("{\"x\":1}").toString("base64") + "\n" }) };
      }
      return { ok: false, status: 404, text: async () => "{\"message\":\"Not Found\"}" };
    };
    const f = await gh.getFile("projects/t/project.json");
    assert.deepEqual(f, { content: "{\"x\":1}", sha: "S", size: 7 });
    assert.equal(await gh.getFile("projects/t/missing.md"), null);
    assert.equal(await gh.getBinary("projects/t/missing.png"), null);
  });

  /* ---------- api/file.js path guard ---------- */

  await t("file handler rejects paths outside the content roots or with traversal", async () => {
    const file = require(path.join(ROOT, "api/file.js"));
    const bad = ["", "../package.json", "projects/../package.json", "projects/x/../../.env", "api/_lib/session.js",
      "/projects/x/script/v1.md", "projects/x/", "projects//x/a.md", "projects/x/./a.md", "projects\\x\\a.md",
      "middleware.js", "ideasx/a.md", "projects/x/a b.md", "projects/x/a.md?x=1"];
    for (const p of bad) assert.equal(file.safePath(p), null, "should reject " + JSON.stringify(p));
    const good = ["projects/x/script/v1.md", "ideas/a-b.md", "guidelines/script.md", "exemplars/s1.md", "projects/x/images/generated/01.png"];
    for (const p of good) assert.equal(file.safePath(p), p);

    // Through the handler, with a GitHub mock that must never be called for a bad path.
    let hits = 0;
    global.fetch = async () => { hits++; return { ok: false, status: 404, text: async () => "{}" }; };
    for (const p of ["../package.json", "api/_lib/session.js", "projects/x/../../.env"]) {
      const res = mockRes();
      await file(mockReq("GET", "/api/file?path=" + encodeURIComponent(p)), res);
      assert.equal(res.statusCode, 400, "status for " + p);
      assert.equal(bodyJSON(res).error, "bad path");
    }
    assert.equal(hits, 0, "GitHub never contacted for rejected paths");

    const res = mockRes();
    await file(mockReq("GET", "/api/file?path=projects/x/script/v1.md"), res);
    assert.equal(res.statusCode, 404);
    assert.equal(hits, 1);
  });

  await t("file handler returns 401 without a session and serves images as bytes", async () => {
    const file = require(path.join(ROOT, "api/file.js"));
    sessionOK = false;
    let hits = 0;
    global.fetch = async () => { hits++; return { ok: true, status: 200 }; };
    let res = mockRes();
    await file(mockReq("GET", "/api/file?path=projects/x/script/v1.md"), res);
    assert.equal(res.statusCode, 401);
    assert.equal(hits, 0);
    sessionOK = true;

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    global.fetch = async (url, init) => {
      assert.equal(init.headers.Accept, "application/vnd.github.raw+json");
      return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    };
    res = mockRes();
    await file(mockReq("GET", "/api/file?path=projects/x/images/generated/01.png"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["cache-control"], "private, max-age=3600");
    assert.ok(Buffer.isBuffer(res.body) && res.body.equals(png));
  });

  /* ---------- project handlers with a mocked github module ---------- */

  const S = require(path.join(ROOT, "tools/state.js"));
  const store = {};       // path -> string | Buffer
  const commits = [];
  mocks.github = true;
  installMock("mock:github", {
    async getTree() {
      return { sha: "T", truncated: false, entries: Object.keys(store).sort().map(p => ({ path: p, type: "blob", size: Buffer.byteLength(store[p]), sha: "s" })) };
    },
    async getFile(p) { return p in store ? { content: String(store[p]), sha: "s", size: Buffer.byteLength(store[p]) } : null; },
    async getBinary(p) { return p in store ? Buffer.from(store[p]) : null; },
    async listDir(dir) {
      return Object.keys(store).filter(p => p.startsWith(dir + "/") && p.slice(dir.length + 1).indexOf("/") < 0)
        .map(p => ({ name: p.slice(dir.length + 1), path: p, type: "file", size: 1, sha: "s" }));
    },
    async commitFiles(opts) {
      commits.push(opts);
      for (const f of opts.files || []) store[f.path] = f.content;
      for (const d of opts.deletes || []) delete store[d];
      return { sha: "C" + commits.length };
    }
  });
  delete require.cache[require.resolve(path.join(ROOT, "api/projects/_shared.js"))];
  const projects = require(path.join(ROOT, "api/projects/index.js"));
  const projectOne = require(path.join(ROOT, "api/projects/[slug]/index.js"));
  const action = require(path.join(ROOT, "api/projects/[slug]/action.js"));
  const task = require(path.join(ROOT, "api/projects/[slug]/task.js"));
  const ideas = require(path.join(ROOT, "api/ideas/index.js"));
  const guidelines = require(path.join(ROOT, "api/guidelines/index.js"));
  const proposal = require(path.join(ROOT, "api/guidelines/proposal.js"));

  await t("project list reads every project.json from one tree fetch and groups by waiting", async () => {
    const a = S.createProject({ title: "Alpha topic", target_minutes: 10 });
    const b = S.createProject({ title: "Beta topic", target_minutes: 12 });
    for (const k of ["research.forums", "research.literature", "research.sources", "research.news"]) S.setTask(b, k, "done");
    S.setTask(b, "synthesis", "done");
    S.setTask(b, "script.draft", "done");
    const c = S.createProject({ title: "Gamma topic", target_minutes: 9 });
    S.setTask(c, "research.sources", "failed", { error: "rate limited" });
    store["projects/alpha-topic/project.json"] = JSON.stringify(a);
    store["projects/beta-topic/project.json"] = JSON.stringify(b);
    store["projects/gamma-topic/project.json"] = JSON.stringify(c);
    store["projects/beta-topic/script/v1.md"] = "# Script\n\nHello.\n";
    store["projects/not-a-project/README.md"] = "x";
    store["projects/broken/project.json"] = "{nope";

    const res = mockRes();
    await projects(mockReq("GET", "/api/projects"), res);
    assert.equal(res.statusCode, 200);
    const out = bodyJSON(res);
    assert.deepEqual(out.projects.map(p => p.slug), ["alpha-topic", "beta-topic", "gamma-topic"]);
    assert.deepEqual(out.errors, [{ path: "projects/broken/project.json", error: "invalid project.json" }]);
    const bySlug = {};
    out.projects.forEach(p => { bySlug[p.slug] = p; });
    assert.equal(bySlug["alpha-topic"].waiting.on, "agents");
    assert.equal(bySlug["alpha-topic"].open.length, 5);
    assert.equal(bySlug["beta-topic"].phase, "script_review");
    assert.equal(bySlug["beta-topic"].waiting.on, "human");
    assert.equal(bySlug["gamma-topic"].failed[0].name, "research.sources");
    assert.equal(bySlug["gamma-topic"].failed[0].error, "rate limited");
  });

  await t("project create commits project.json, idea.md, .gitkeep files and marks the idea started", async () => {
    store["ideas/new-idea.md"] = "title: New idea\nsource: hermes\nfound: 2026-10-09\nstatus: new\n\nWhy now.\n";
    const res = mockRes();
    await projects(mockReq("POST", "/api/projects", { title: "New idea", minutes: 11, idea: "ideas/new-idea.md" }), res);
    assert.equal(res.statusCode, 201, res.body);
    const out = bodyJSON(res);
    assert.equal(out.project.slug, "new-idea");
    assert.equal(out.project.target_minutes, 11);
    assert.equal(out.project.idea, "ideas/new-idea.md");
    const c = commits[commits.length - 1];
    assert.equal(c.message, "ui: start new-idea");
    assert.deepEqual(c.files.map(f => f.path).sort(), [
      "ideas/new-idea.md", "projects/new-idea/idea.md", "projects/new-idea/images/generated/.gitkeep", "projects/new-idea/outline/.gitkeep",
      "projects/new-idea/package/.gitkeep", "projects/new-idea/project.json", "projects/new-idea/research/.gitkeep",
      "projects/new-idea/script/.gitkeep", "projects/new-idea/slides/.gitkeep"
    ]);
    assert.ok(/^status: started$/m.test(store["ideas/new-idea.md"]));
    assert.equal(store["projects/new-idea/idea.md"], "title: New idea\nsource: hermes\nfound: 2026-10-09\nstatus: new\n\nWhy now.\n");
    assert.deepEqual(S.validate(JSON.parse(store["projects/new-idea/project.json"])), []);

    // Duplicate, bad minutes, bad idea path.
    let r2 = mockRes();
    await projects(mockReq("POST", "/api/projects", { title: "New idea", minutes: 10 }), r2);
    assert.equal(r2.statusCode, 409);
    r2 = mockRes();
    await projects(mockReq("POST", "/api/projects", { title: "Other", minutes: 3 }), r2);
    assert.equal(r2.statusCode, 400);
    r2 = mockRes();
    await projects(mockReq("POST", "/api/projects", { title: "Other", minutes: 9, idea: "../secrets.md" }), r2);
    assert.equal(r2.statusCode, 400);
    // Without an idea file the idea.md header is generated.
    r2 = mockRes();
    await projects(mockReq("POST", "/api/projects", { title: "Plain start", minutes: 9 }), r2);
    assert.equal(r2.statusCode, 201);
    assert.ok(/^title: Plain start\nsource: human\nfound: \d{4}-\d\d-\d\d\nstatus: started\n\n$/.test(store["projects/plain-start/idea.md"]));
  });

  await t("project detail returns the file index of the folder", async () => {
    const res = mockRes();
    await projectOne(mockReq("GET", "/api/projects/beta-topic"), res);
    assert.equal(res.statusCode, 200);
    const out = bodyJSON(res);
    assert.equal(out.project.slug, "beta-topic");
    assert.equal(out.waiting.on, "human");
    assert.deepEqual(out.files.map(f => f.path), ["project.json", "script/v1.md"]);
    const r404 = mockRes();
    await projectOne(mockReq("GET", "/api/projects/nope"), r404);
    assert.equal(r404.statusCode, 404);
    const rbad = mockRes();
    await projectOne(mockReq("GET", "/api/projects/..%2F..%2Fx"), rbad);
    assert.equal(rbad.statusCode, 400);
  });

  await t("actions run through applyAction, execute ops against the repo and commit once", async () => {
    let res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "script.feedback", payload: { text: "Shorter intro." } }), res);
    assert.equal(res.statusCode, 200, res.body);
    let c = commits[commits.length - 1];
    assert.equal(c.message, "ui(beta-topic): script.feedback");
    assert.deepEqual(c.files.map(f => f.path), ["projects/beta-topic/script/feedback-v1.md", "projects/beta-topic/project.json"]);
    assert.ok(store["projects/beta-topic/script/feedback-v1.md"].indexOf("Shorter intro.") > 0);
    assert.equal(bodyJSON(res).project.tasks["script.revise"].status, "todo");
    assert.equal(bodyJSON(res).waiting.on, "claude");

    // Approve is refused while the revision is open; the state machine's message comes back as a 400.
    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "script.approve", payload: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.match(bodyJSON(res).error, /revision/);

    // Simulate Claude finishing the revision, then approve: copy op reads v2 from the repo.
    const p = JSON.parse(store["projects/beta-topic/project.json"]);
    S.setTask(p, "script.revise", "done");
    p.script_version = 2;
    store["projects/beta-topic/project.json"] = JSON.stringify(p);
    store["projects/beta-topic/script/v2.md"] = "# Script v2\n";
    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "script.approve", payload: {} }), res);
    assert.equal(res.statusCode, 200, res.body);
    c = commits[commits.length - 1];
    assert.equal(c.message, "ui(beta-topic): script.approve");
    assert.deepEqual(c.files.map(f => f.path), ["projects/beta-topic/script/final.md", "projects/beta-topic/project.json"]);
    assert.equal(String(store["projects/beta-topic/script/final.md"]), "# Script v2\n");
    assert.equal(bodyJSON(res).project.phase, "outline_images");

    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "rm -rf", payload: {} }), res);
    assert.equal(res.statusCode, 400);
  });

  await t("image decisions, slide order and review.finish read the project files", async () => {
    const p = JSON.parse(store["projects/beta-topic/project.json"]);
    for (const k of ["outline.draft", "images.prompts", "images.generate"]) S.setTask(p, k, "done");
    assert.equal(p.phase, "review");
    store["projects/beta-topic/project.json"] = JSON.stringify(p);
    store["projects/beta-topic/outline/v1.md"] = "# Outline\n";
    store["projects/beta-topic/images/prompts.json"] = JSON.stringify({ prompts: [{ id: "01", prompt: "a" }, { id: "02", prompt: "b" }] });

    let res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "images.decide", payload: { decisions: { "01": { decision: "approve" }, "02": { decision: "reject" } } } }), res);
    assert.equal(res.statusCode, 200, res.body);
    const d = JSON.parse(store["projects/beta-topic/images/decisions.json"]);
    assert.equal(d.decisions["01"].decision, "approve");

    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "slides.order", payload: { order: ["02"] } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(bodyJSON(res).error, /not approved/);

    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "slides.order", payload: { order: ["01"] } }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(JSON.parse(store["projects/beta-topic/slides/order.json"]).order, ["01"]);

    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "review.finish", payload: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.match(bodyJSON(res).error, /outline not approved/);

    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "outline.approve", payload: {} }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(String(store["projects/beta-topic/outline/final.md"]), "# Outline\n");

    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "review.finish", payload: {} }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(bodyJSON(res).project.phase, "slides");
    assert.equal(commits[commits.length - 1].message, "ui(beta-topic): review.finish");
  });

  await t("task retry only moves a failed task back to todo", async () => {
    let res = mockRes();
    await task(mockReq("POST", "/api/projects/gamma-topic/task", { task: "research.sources", status: "todo" }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(bodyJSON(res).project.tasks["research.sources"].status, "todo");
    assert.equal(commits[commits.length - 1].message, "ui(gamma-topic): retry research.sources");
    res = mockRes();
    await task(mockReq("POST", "/api/projects/gamma-topic/task", { task: "research.sources", status: "todo" }), res);
    assert.equal(res.statusCode, 409);
    res = mockRes();
    await task(mockReq("POST", "/api/projects/gamma-topic/task", { task: "research.news", status: "done" }), res);
    assert.equal(res.statusCode, 400);
  });

  await t("ideas list parses headers and create writes the Hermes format with source human", async () => {
    let res = mockRes();
    await ideas(mockReq("POST", "/api/ideas", { title: "Chemo brain", text: "People ask about memory." }), res);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(store["ideas/chemo-brain.md"].split("\n\n")[0].split("\n").length, 4);
    assert.match(store["ideas/chemo-brain.md"], /^title: Chemo brain\nsource: human\nfound: \d{4}-\d\d-\d\d\nstatus: new\n\nPeople ask about memory\.\n$/);
    assert.equal(commits[commits.length - 1].message, "ui: idea chemo-brain");
    res = mockRes();
    await ideas(mockReq("GET", "/api/ideas"), res);
    const out = bodyJSON(res);
    const byslug = {};
    out.ideas.forEach(i => { byslug[i.slug] = i; });
    assert.equal(byslug["new-idea"].status, "started");
    assert.equal(byslug["new-idea"].source, "hermes");
    assert.equal(byslug["new-idea"].body, "Why now.");
    assert.equal(byslug["chemo-brain"].status, "new");
    res = mockRes();
    await ideas(mockReq("POST", "/api/ideas", { title: "Chemo brain" }), res);
    assert.equal(res.statusCode, 409);
  });

  await t("guidelines: read, edit, and accept or reject proposals", async () => {
    store["guidelines/script.md"] = "# Script rules\n\nUse plain words.\n";
    store["guidelines/images.md"] = "# Image rules\n";
    store["guidelines/outline.md"] = "# Outline rules\n";
    store["guidelines/proposals/beta-topic.json"] = JSON.stringify({
      slug: "beta-topic", created: "2026-10-09", proposals: [
        { id: "p1", file: "script.md", rationale: "Feedback asked for shorter intros twice.", current_excerpt: "Use plain words.", proposed_text: "Use plain words. Keep the intro under 90 seconds." },
        { id: "p2", file: "images.md", rationale: "Rejected images were busy.", current_excerpt: "", proposed_text: "Avoid crowded scenes." },
        { id: "p3", file: "../.env", rationale: "bad", current_excerpt: "", proposed_text: "x" }
      ]
    });
    let res = mockRes();
    await guidelines(mockReq("GET", "/api/guidelines"), res);
    let out = bodyJSON(res);
    assert.equal(out.files["script.md"], "# Script rules\n\nUse plain words.\n");
    assert.equal(out.proposals[0].proposals.length, 3);

    res = mockRes();
    await guidelines(mockReq("PUT", "/api/guidelines", { file: "outline.md", content: "# Outline rules\n\nThree parts." }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(store["guidelines/outline.md"], "# Outline rules\n\nThree parts.\n");
    assert.equal(commits[commits.length - 1].message, "ui: edit guidelines/outline.md");
    res = mockRes();
    await guidelines(mockReq("PUT", "/api/guidelines", { file: "../package.json", content: "x" }), res);
    assert.equal(res.statusCode, 400);

    res = mockRes();
    await proposal(mockReq("POST", "/api/guidelines/proposal", { slug: "beta-topic", id: "p1", decision: "accept" }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(store["guidelines/script.md"], "# Script rules\n\nUse plain words. Keep the intro under 90 seconds.\n");
    let doc = JSON.parse(store["guidelines/proposals/beta-topic.json"]);
    assert.equal(doc.proposals[0].decided, "accept");
    assert.ok(doc.proposals[0].decided_at);
    const c = commits[commits.length - 1];
    assert.equal(c.message, "ui: accept proposal beta-topic#p1");
    assert.deepEqual(c.files.map(f => f.path), ["guidelines/script.md", "guidelines/proposals/beta-topic.json"]);

    res = mockRes();
    await proposal(mockReq("POST", "/api/guidelines/proposal", { slug: "beta-topic", id: "p1", decision: "reject" }), res);
    assert.equal(res.statusCode, 409);

    res = mockRes();
    await proposal(mockReq("POST", "/api/guidelines/proposal", { slug: "beta-topic", id: "p2", decision: "reject" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(store["guidelines/images.md"], "# Image rules\n");
    doc = JSON.parse(store["guidelines/proposals/beta-topic.json"]);
    assert.equal(doc.proposals[1].decided, "reject");
    assert.equal(commits[commits.length - 1].files.length, 1);

    res = mockRes();
    await proposal(mockReq("POST", "/api/guidelines/proposal", { slug: "beta-topic", id: "p3", decision: "accept" }), res);
    assert.equal(res.statusCode, 400);
    assert.ok(!("guidelines/../.env" in store));

    // Append when the excerpt is absent.
    assert.equal(proposal.applyProposal("# A\n\nold\n", { current_excerpt: "missing", proposed_text: "new para" }), "# A\n\nold\n\nnew para\n");
  });

  await t("handlers reject other methods and unauthenticated calls", async () => {
    let res = mockRes();
    await projects(mockReq("DELETE", "/api/projects"), res);
    assert.equal(res.statusCode, 405);
    sessionOK = false;
    res = mockRes();
    await action(mockReq("POST", "/api/projects/beta-topic/action", { action: "script.approve" }), res);
    assert.equal(res.statusCode, 401);
    sessionOK = true;
  });

  console.log(n + " tests passed");
})().catch(e => { console.error(e); process.exit(1); });
