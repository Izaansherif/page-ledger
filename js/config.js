// js/config.js
// Fetches /.netlify/functions/config once and caches the result so every
// module can ask: is the Supabase project wired up, and where is it?
let cached = null;

export async function getConfig() {
  if (cached) return cached;
  let out = { configured: false };
  try {
    const res = await fetch("/.netlify/functions/config", { method: "POST" });
    if (res.ok) {
      const body = await res.json();
      if (body?.configured) out = { configured: true, url: body.url, publishable: body.publishable };
    }
  } catch {
    // offline / server down -> treated as not configured
  }
  cached = out;
  return cached;
}
