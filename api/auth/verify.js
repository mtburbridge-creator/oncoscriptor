"use strict";
// POST /api/auth/verify
// Body: the AuthenticationResponseJSON from startAuthentication(). Verifies it
// against the enrolled credential and the challenge cookie, then sets og_session.
const { verifyAuthenticationResponse } = require("@simplewebauthn/server");
const S = require("../_lib/session");
const rl = require("../_lib/ratelimit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.sendJson(res, 405, { error: "method_not_allowed" });
  if (!rl.guard(req, res)) return;
  const ip = rl.clientIp(req);

  let cred, rp;
  try {
    cred = S.credentialFromEnv();
    rp = S.rpConfig();
  } catch (e) {
    return S.sendJson(res, 500, { error: "server_misconfigured", detail: e.message });
  }
  if (!cred) return S.sendJson(res, 404, { error: "not_found" });

  // The challenge is single use: clear the cookie no matter what happens next.
  const challenge = S.readChallenge(req, "auth");
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
  if (body.id !== cred.id) {
    rl.recordFailure(ip);
    return S.sendJson(res, 401, { error: "unknown_credential" });
  }

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: cred,
      // userVerification is "preferred" in the options, so do not demand it here.
      requireUserVerification: false,
    });
  } catch (e) {
    rl.recordFailure(ip);
    return S.sendJson(res, 401, { error: "verification_failed", detail: e.message });
  }
  if (!result || !result.verified) {
    rl.recordFailure(ip);
    return S.sendJson(res, 401, { error: "verification_failed" });
  }

  // Counter policy (enforced inside verifyAuthenticationResponse, v13):
  //   stored counter 0  -> any reported counter is accepted (synced passkeys always say 0)
  //   stored counter >0 -> the reported counter must be greater, else it throws above
  // We cannot write the new counter back into an environment variable, so a
  // hardware key that increments will keep verifying against the enrolled value.
  // See docs/AUTH.md, "Counters".
  const newCounter = result.authenticationInfo.newCounter;
  if (cred.counter > 0 && newCounter > cred.counter) {
    console.warn("[auth] counter advanced to " + newCounter + " but PASSKEY_CREDENTIAL still holds " + cred.counter);
  }

  rl.clear(ip);
  S.setSessionCookie(res, S.createSession());
  return S.sendJson(res, 200, { ok: true });
};
