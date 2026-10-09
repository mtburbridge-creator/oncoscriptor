"use strict";
// GET /api/auth/me: {ok:true, exp} when the session cookie verifies, else 401.
const S = require("../_lib/session");

module.exports = async (req, res) => {
  if (req.method !== "GET") return S.sendJson(res, 405, { error: "method_not_allowed" });
  const session = S.requireSession(req, res);
  if (!session) return;
  return S.sendJson(res, 200, { ok: true, sub: session.sub, iat: session.iat, exp: session.exp });
};
