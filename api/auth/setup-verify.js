"use strict";
// POST /api/auth/setup-verify   (enrollment, step 2)
// Body: the RegistrationResponseJSON from startRegistration(). Verifies it and
// returns the credential to paste into PASSKEY_CREDENTIAL. Stores nothing.
const { verifyRegistrationResponse } = require("@simplewebauthn/server");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");
const S = require("../_lib/session");
const rl = require("../_lib/ratelimit");
const { tokenOk } = require("./setup-options");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.sendJson(res, 405, { error: "method_not_allowed" });
  if (!rl.guard(req, res)) return;
  const ip = rl.clientIp(req);
  if (!tokenOk(req)) {
    if (process.env.SETUP_TOKEN) rl.recordFailure(ip);
    return S.sendJson(res, 404, { error: "not_found" });
  }

  let rp;
  try {
    rp = S.rpConfig();
  } catch (e) {
    return S.sendJson(res, 500, { error: "server_misconfigured", detail: e.message });
  }

  const challenge = S.readChallenge(req, "reg");
  S.clearChallengeCookie(res);
  if (!challenge) {
    rl.recordFailure(ip);
    return S.sendJson(res, 400, { error: "challenge_missing_or_expired" });
  }

  const body = await S.readBody(req);
  if (!body || typeof body.id !== "string" || !body.response) {
    rl.recordFailure(ip);
    return S.sendJson(res, 400, { error: "bad_request" });
  }

  let result;
  try {
    result = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    rl.recordFailure(ip);
    return S.sendJson(res, 400, { error: "verification_failed", detail: e.message });
  }
  if (!result.verified || !result.registrationInfo) {
    rl.recordFailure(ip);
    return S.sendJson(res, 400, { error: "verification_failed" });
  }

  const info = result.registrationInfo;
  const credential = {
    id: info.credential.id,
    publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports || body.response.transports || [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
  };
  rl.clear(ip);
  return S.sendJson(res, 200, {
    ok: true,
    credential,
    PASSKEY_CREDENTIAL: JSON.stringify(credential),
    next: "Set PASSKEY_CREDENTIAL to the string above in Vercel, remove SETUP_TOKEN, redeploy.",
  });
};
