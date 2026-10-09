// Passkey sign-in and one-time enrollment. No framework.
// Depends on /vendor/simplewebauthn-browser.js (window.SimpleWebAuthnBrowser, v13:
// startAuthentication({ optionsJSON }) and startRegistration({ optionsJSON })).
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function lib() {
    var l = window.SimpleWebAuthnBrowser;
    if (!l || typeof l.startAuthentication !== "function") {
      throw new Error("The passkey library did not load (/vendor/simplewebauthn-browser.js).");
    }
    return l;
  }

  async function post(url, body, headers) {
    var h = { "content-type": "application/json" };
    if (headers) for (var k in headers) h[k] = headers[k];
    var r = await fetch(url, {
      method: "POST",
      headers: h,
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
    });
    var data = null;
    try { data = await r.json(); } catch (e) { /* non-JSON error body */ }
    if (!r.ok) {
      var err = new Error((data && data.error) || ("HTTP " + r.status));
      err.status = r.status;
      err.detail = data && data.detail;
      throw err;
    }
    return data;
  }

  function explain(err, context) {
    if (err && err.name === "NotAllowedError") return "Cancelled or timed out. Try again.";
    if (err && err.status === 429) return "Too many failed attempts. This address is locked for an hour.";
    if (err && err.status === 404 && context === "signin") return "No passkey is enrolled yet. Open this page with ?setup=1 to enroll one.";
    if (err && err.status === 404 && context === "setup") return "Enrollment is closed or the token is wrong. SETUP_TOKEN must be set in Vercel and match.";
    if (err && err.message === "challenge_missing_or_expired") return "The challenge expired. Try again.";
    return (err && err.message) ? err.message + (err.detail ? " (" + err.detail + ")" : "") : "Something went wrong.";
  }

  // ---- sign in ----
  var signinBtn = $("#signin");
  var signinStatus = $("#signin-status");

  async function signIn() {
    signinBtn.disabled = true;
    setStatus(signinStatus, "Waiting for your passkey…");
    try {
      var options = await post("/api/auth/options");
      var assertion = await lib().startAuthentication({ optionsJSON: options });
      await post("/api/auth/verify", assertion);
      setStatus(signinStatus, "Signed in. Redirecting…", "ok");
      window.location.replace("/");
    } catch (err) {
      setStatus(signinStatus, explain(err, "signin"), "bad");
      signinBtn.disabled = false;
    }
  }
  signinBtn.addEventListener("click", signIn);

  // ---- enrollment (?setup=1) ----
  var params = new URLSearchParams(window.location.search);
  if (params.get("setup") === "1") {
    $("#setup-panel").classList.remove("hidden");
  }

  var enrollBtn = $("#enroll");
  var setupStatus = $("#setup-status");

  async function enroll() {
    var token = $("#setup-token").value.trim();
    if (!token) { setStatus(setupStatus, "Enter the setup token first.", "bad"); return; }
    enrollBtn.disabled = true;
    setStatus(setupStatus, "Creating a passkey on this device…");
    try {
      var headers = { "x-setup-token": token };
      var options = await post("/api/auth/setup-options", {}, headers);
      var attestation = await lib().startRegistration({ optionsJSON: options });
      var out = await post("/api/auth/setup-verify", attestation, headers);
      $("#credential").value = out.PASSKEY_CREDENTIAL;
      $("#setup-result").classList.remove("hidden");
      setStatus(setupStatus, "Passkey created. Copy the value below into Vercel.", "ok");
    } catch (err) {
      setStatus(setupStatus, explain(err, "setup"), "bad");
    } finally {
      enrollBtn.disabled = false;
    }
  }
  enrollBtn.addEventListener("click", enroll);

  $("#copy").addEventListener("click", async function () {
    var ta = $("#credential");
    try {
      await navigator.clipboard.writeText(ta.value);
      setStatus(setupStatus, "Copied.", "ok");
    } catch (e) {
      ta.focus(); ta.select();
      setStatus(setupStatus, "Select the text and copy it manually.");
    }
  });

  if (!window.PublicKeyCredential) {
    setStatus(signinStatus, "This browser does not support passkeys.", "bad");
    signinBtn.disabled = true;
    enrollBtn.disabled = true;
  }
})();
