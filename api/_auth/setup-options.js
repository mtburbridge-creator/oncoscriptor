"use strict";
// POST /api/auth/setup-options   (enrollment, step 1)
// Exists only while SETUP_TOKEN is set. Header x-setup-token must match it.
// Returns WebAuthn creation options and sets the signed og_challenge cookie.
const crypto = require("crypto");
const { generateRegistrationOptions } = require("@simplewebauthn/server");
const S = require("../_lib/session");
const rl = require("../_lib/ratelimit");

// A fixed user handle: there is exactly one user, "owner".
const OWNER_USER_ID = new Uint8Array(crypto.createHash("sha256").update("oncogenik:owner").digest().subarray(0, 16));

function tokenOk(req) {
  const expected = process.env.SETUP_TOKEN;
  const given = req.headers && (req.headers["x-setup-token"] || req.headers["X-Setup-Token"]);
  if (!expected || typeof given !== "string" || !given) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.sendJson(res, 405, { error: "method_not_allowed" });
  if (!rl.guard(req, res)) return;
  if (!tokenOk(req)) {
    if (process.env.SETUP_TOKEN) rl.recordFailure(rl.clientIp(req));
    return S.sendJson(res, 404, { error: "not_found" });
  }

  let rp;
  try {
    rp = S.rpConfig();
  } catch (e) {
    return S.sendJson(res, 500, { error: "server_misconfigured", detail: e.message });
  }

  const options = await generateRegistrationOptions({
    rpName: "OncoGenik",
    rpID: rp.rpID,
    userName: "owner",
    userDisplayName: "OncoGenik owner",
    userID: OWNER_USER_ID,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    timeout: 120000,
  });
  S.setChallengeCookie(res, options.challenge, "reg");
  return S.sendJson(res, 200, options);
};

module.exports.tokenOk = tokenOk;
module.exports.OWNER_USER_ID = OWNER_USER_ID;
