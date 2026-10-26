// js/api.js
// Thin client for the (local Netlify-compatible) /.netlify/functions/extract
// endpoint. Leaves all error message wording to the server but guarantees the
// UI always gets { ok, error } shape on failure. Stage 2: attaches the
// Supabase session token when the user is signed in.

export async function extractPage({ imageBase64, mime, baseDate, mockFixture }, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch("/.netlify/functions/extract", {
      method: "POST",
      headers,
      body: JSON.stringify({ imageBase64, mime, baseDate, mockFixture }),
    });
  } catch (e) {
    // network-level failure (offline, server down)
    const err = new Error("Could not reach the reading service. Check your internet connection and try again.");
    err.network = true;
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: "The reader sent back data the app could not parse." };
  }
  if (!res.ok || !body?.ok) {
    const err = new Error(body?.error || `Reading failed (HTTP ${res.status}).`);
    err.detail = body?.detail;
    err.status = res.status;
    throw err;
  }
  return body;
}
