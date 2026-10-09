"use strict";
// POST /api/guidelines/proposal { slug, id, decision: "accept" | "reject" }
// Accept writes the proposed text into the guideline; either way the
// proposal is marked decided. One commit.
const gh = require("../_lib/github");
const H = require("../_lib/http");
const { FILES } = require("./index");

// Apply one proposal to a guideline's text. Replace the quoted excerpt when it
// is present, otherwise append the proposed text as a new paragraph.
function applyProposal(current, proposal) {
  const text = String(proposal.proposed_text || "").replace(/\r\n/g, "\n");
  const excerpt = String(proposal.current_excerpt || "").replace(/\r\n/g, "\n");
  let out;
  if (excerpt && current.indexOf(excerpt) >= 0) out = current.replace(excerpt, text);
  else if (excerpt && current.indexOf(excerpt.trim()) >= 0) out = current.replace(excerpt.trim(), text.trim());
  else out = current.replace(/\s*$/, "") + "\n\n" + text.trim() + "\n";
  if (out && !out.endsWith("\n")) out += "\n";
  return out;
}

module.exports = H.handler(async (req, res) => {
  const session = require("../_lib/session").requireSession(req, res); if (!session) return;
  if (!H.methods(req, res, ["POST"])) return;
  const body = await H.readBody(req);
  const slug = String(body.slug || "");
  const id = String(body.id || "");
  const decision = body.decision;
  if (!H.isSafeSlug(slug)) throw new H.HttpError(400, "bad slug");
  if (!id) throw new H.HttpError(400, "id required");
  if (decision !== "accept" && decision !== "reject") throw new H.HttpError(400, "decision must be accept or reject");

  const path = "guidelines/proposals/" + slug + ".json";
  const f = await gh.getFile(path);
  if (!f) throw new H.HttpError(404, "no proposals file for " + slug);
  let doc;
  try { doc = JSON.parse(f.content); } catch (e) { throw new H.HttpError(500, "proposals file is not valid JSON"); }
  const proposal = (doc.proposals || []).find(p => String(p.id) === id);
  if (!proposal) throw new H.HttpError(404, "no proposal " + id + " in " + slug);
  if (proposal.decided) throw new H.HttpError(409, "proposal " + id + " already " + proposal.decided);

  const files = [];
  if (decision === "accept") {
    const file = String(proposal.file || "").replace(/^guidelines\//, "");
    if (FILES.indexOf(file) < 0) throw new H.HttpError(400, "proposal targets unknown guideline " + proposal.file);
    const cur = await gh.getFile("guidelines/" + file);
    files.push({ path: "guidelines/" + file, content: applyProposal(cur ? cur.content : "", proposal) });
  }
  proposal.decided = decision;
  proposal.decided_at = new Date().toISOString();
  files.push({ path, content: JSON.stringify(doc, null, 2) + "\n" });
  const commit = await gh.commitFiles({ message: "ui: " + decision + " proposal " + slug + "#" + id, files });
  H.send(res, 200, { slug, id, decision, commit: commit.sha });
});
module.exports.applyProposal = applyProposal;
