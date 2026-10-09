"use strict";
// Best-effort kick of the Claude Code routine after a commit that may have
// created Claude work. Never throws. No-op when the two env vars are unset.
async function fireRoutine(hint) {
  const url = process.env.ROUTINE_FIRE_URL;
  const token = process.env.ROUTINE_FIRE_TOKEN;
  if (!url || !token) return { fired: false, reason: "not configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: String(hint || "ui").slice(0, 500) })
    });
    if (!res.ok) return { fired: false, reason: "http " + res.status };
    const body = await res.json().catch(() => ({}));
    return { fired: true, session: body.claude_code_session_url || null };
  } catch (e) {
    return { fired: false, reason: e.message };
  }
}
module.exports = { fireRoutine };
