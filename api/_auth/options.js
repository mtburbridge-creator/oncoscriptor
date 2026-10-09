"use strict";
// POST /api/auth/options
// Start a passkey login: returns WebAuthn request options and sets the signed
// og_challenge cookie. 404 until a passkey is enrolled (PASSKEY_CREDENTIAL).
const { generateAuthenticationOptions } = require("@simplewebauthn/server");
const S = require("../_lib/session");
const rl = require("../_lib/ratelimit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.sendJson(res, 405, { error: "method_not_allowed" });
  if (!rl.guard(req, res)) return;

  let cred, rp;
  try {
    cred = S.credentialFromEnv();
    rp = S.rpConfig();
  } catch (e) {
    return S.sendJson(res, 500, { error: "server_misconfigured", detail: e.message });
  }
  if (!cred) return S.sendJson(res, 404, { error: "not_found" });

  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: [{ id: cred.id, transports: cred.transports }],
    userVerification: "preferred",
    timeout: 60000,
  });
  S.setChallengeCookie(res, options.challenge, "auth");
  return S.sendJson(res, 200, options);
};
