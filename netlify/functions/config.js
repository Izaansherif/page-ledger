// netlify/functions/config.js
// ---------------------------------------------------------------------------
// /.netlify/functions/config  (Stage 2)
// Tells the app how to reach its Supabase project. Only the PROJECT URL and
// the PUBLISHABLE (anon) key are returned - both are designed to be public.
// The secret/service key never leaves the server env.
// When SUPABASE_URL / SUPABASE_PUBLISHABLE are unset, the app runs in
// Stage-1 mode: review only, nothing saved.
// ---------------------------------------------------------------------------
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

export async function handler(event) {
  const method = (event?.httpMethod || "GET").toUpperCase();
  if (method !== "POST") {
    return json(405, { ok: false, error: "Use POST." });
  }

  const url = process.env.SUPABASE_URL || "";
  const publishable = process.env.SUPABASE_PUBLISHABLE || "";
  const ready = url.startsWith("https://") && publishable.length > 10;

  if (!ready) {
    return json(200, { ok: true, configured: false });
  }
  return json(200, {
    ok: true,
    configured: true,
    url: url.replace(/\/+$/, ""),
    publishable,
  });
}
