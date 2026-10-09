"use strict";
// POST /api/auth/logout: clears the session cookie.
const S = require("../_lib/session");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.sendJson(res, 405, { error: "method_not_allowed" });
  S.clearSessionCookie(res);
  return S.sendJson(res, 200, { ok: true });
};
