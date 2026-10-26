// js/api.js
// Thin client for the local Netlify-compatible functions. Leaves all error
// message wording to the server but guarantees the UI always gets
// { ok, error } shape on failure. Stage 2: attaches the Supabase session
// token when the user is signed in.

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

// Stage 4: voice follow-up notes. { wavBase64 } -> { transcribed, ... }.
export async function transcribeAudio({ wavBase64, token = null }) {  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      headers,
      body: JSON.stringify({ audioBase64: wavBase64 }),
    });
  } catch (e) {
    const err = new Error("Could not reach the speech service. Check your internet connection and try again.");
    err.network = true;
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: "The speech service sent back data the app could not parse." };
  }
  if (!res.ok || !body?.ok) {
    const err = new Error(body?.error || `Transcribing failed (HTTP ${res.status}).`);
    err.detail = body?.detail;
    err.status = res.status;
    throw err;
  }
  return body;
}

// Stage 6: ask about figures already in the owner's ledger.
// { question, brief } -> { ok, answer, basedOn, demoMode, ... }.
export async function askLedger({ question, brief, token = null }) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch("/.netlify/functions/ask", {
      method: "POST",
      headers,
      body: JSON.stringify({ question, brief }),
    });
  } catch (e) {
    const err = new Error("Could not reach the answer service. Check your internet connection and try again.");
    err.network = true;
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: "The answer service sent back data the app could not parse." };
  }
  if (!res.ok || !body?.ok) {
    const err = new Error(body?.error || `Asking failed (HTTP ${res.status}).`);
    err.detail = body?.detail;
    err.status = res.status;
    throw err;
  }
  return body;
}
