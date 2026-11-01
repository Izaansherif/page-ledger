// api/_adapt.js
// ---------------------------------------------------------------------------
// Vercel adapter. The four real handlers live in netlify/functions/ and keep
// working on Netlify untouched. This wrapper turns a Vercel (req, res) call
// into the { httpMethod, headers, body } event those handlers expect, then
// writes their { statusCode, headers, body } result back. Files starting with
// "_" inside /api are NOT turned into routes by Vercel.
// ---------------------------------------------------------------------------
async function readBody(req) {
  const b = req.body;
  if (typeof b === "string") return b;
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  if (b && typeof b === "object") return JSON.stringify(b);
  if (req.readable) {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    return Buffer.concat(chunks).toString("utf8");
  }
  return "";
}

export function wrap(handler) {
  return async function vercelHandler(req, res) {
    try {
      const out = await handler({
        httpMethod: String(req.method || "GET").toUpperCase(),
        headers: req.headers || {},
        body: await readBody(req),
        isBase64Encoded: false,
        queryStringParameters: req.query || {},
      });
      res.statusCode = out?.statusCode || 200;
      for (const [k, v] of Object.entries(out?.headers || {})) res.setHeader(k, v);
      res.end(typeof out?.body === "string" ? out.body : JSON.stringify(out?.body ?? ""));
    } catch (err) {
      console.error("[vercel adapter] function error:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Something went wrong on the server. Please try again." }));
    }
  };
}
