// netlify/functions/extract.js
// ---------------------------------------------------------------------------
// /.netlify/functions/extract  (Stage 1)
// Receives { imageBase64, mime, baseDate? } and returns the structured,
// validated extraction of one notebook page. ALL AI work lives in _lib/ai.js
// (rule 3) - this file is only the HTTP shell: input checks, retry semantics
// (extractPage already retries once), usage/cost reporting, friendly errors.
//
// NOTE (Stage 2): once auth exists, this must reject requests without a
// signed-in user (hard requirement: AI functions require a signed-in user).
// ---------------------------------------------------------------------------
import { extractPage, AI_CONFIG, estimateCostUSD } from "./_lib/ai.js";

const MAX_BODY_CHARS = 12 * 1024 * 1024; // ~12 MB JSON envelope (image is ~1 MB after browser resize)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

export async function handler(event) {
  const method = (event?.httpMethod || event?.requestContext?.http?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return json(405, { ok: false, error: "Send a POST request with the image, e.g. from the Page Ledger app." });
  }

  let req;
  try {
    req = JSON.parse(event?.body ?? "{}");
  } catch {
    return json(400, { ok: false, error: "The request body was not valid JSON." });
  }
  if (!req || typeof req !== "object") {
    return json(400, { ok: false, error: "The request body was not a JSON object." });
  }

  const imageBase64 = typeof req.imageBase64 === "string" ? req.imageBase64.replace(/^data:[^;]+;base64,/, "") : null;
  const mime = typeof req.mime === "string" ? req.mime : "image/jpeg";
  const baseDate =
    typeof req.baseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.baseDate)
      ? req.baseDate
      : new Date().toISOString().slice(0, 10);

  if (!imageBase64) {
    if (AI_CONFIG.mode === "mock") {
      // The sample-page flow may skip the image entirely in mock mode.
    } else {
      return json(400, { ok: false, error: "No image was sent. Please pick a photo of a notebook page and try again." });
    }
  }
  if (imageBase64 && imageBase64.length > MAX_BODY_CHARS) {
    return json(413, { ok: false, error: "The photo is too large. The app resizes pages to a 1600px long edge - if you see this, try a smaller file." });
  }
  if (!ALLOWED_MIME.has(mime)) {
    return json(415, { ok: false, error: `Unsupported image type "${mime}". Supported: JPEG, PNG, WebP, GIF.` });
  }

  try {
    const result = await extractPage({ imageBase64, mime, baseDate, fixture: req.mockFixture || "spike/page1" });
    const costUSD = estimateCostUSD(result.usage);
    console.log(
      `[extract] model=${result.model} latency=${result.latencyMs}ms retries=${result.retries} ` +
        `usage=${result.usage ? `in:${result.usage.input} out:${result.usage.output} cached:${result.usage.cachedInput}` : "mock"} ` +
        `costUSD=${costUSD ?? "n/a(mock)"}`,
    );
    return json(200, {
      ok: true,
      extraction: result.extraction,
      usage: result.usage,
      estCostUSD: costUSD,
      model: result.model,
      latencyMs: result.latencyMs,
      retries: result.retries,
      baseDate,
      demoMode: AI_CONFIG.mode === "mock",
    });
  } catch (err) {
    console.error("[extract] failed:", err.message);
    if (err.code === "EXTRACTION_INVALID") {
      return json(502, {
        ok: false,
        error: "The reading came back unreadable twice. You can retry - or edit the page photo and try again.",
        detail: err.validationErrors ?? null,
      });
    }
    const status = err.status ?? 500;
    const friendly =
      status === 401
        ? "The AI service did not accept the key. Check META_API_KEY in Netlify env vars or .env."
        : status === 429
          ? "The AI service is busy (rate limit). Wait a few seconds and try again."
          : "The AI service did not respond. Please try again in a moment.";
    return json(status >= 400 && status < 600 ? status : 500, { ok: false, error: friendly, detail: err.message });
  }
}
