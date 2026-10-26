// netlify/functions/_lib/ai.js
// ---------------------------------------------------------------------------
// ALL AI calls in Pagebook go through this single module (project rule 3).
//
// Everything below was confirmed from https://dev.meta.ai/docs on 2026-10-26
// (pages: /overview, /image-understanding, /structured-output,
// /pricing-rate-limits). Do NOT change model names, endpoint or pricing from
// memory - the project rule is: never guess the Meta API.
//
// Verified facts in use here:
//   - Base URL https://api.meta.ai/v1, auth header "Authorization: Bearer <key>"
//   - Chat Completions endpoint POST /v1/chat/completions is OpenAI-compatible
//   - Images go in a user message as {"type":"image_url","image_url":{"url":
//     "data:image/jpeg;base64,..."}} (base64 data URL - no hosting needed)
//   - Structured output: response_format { type:"json_schema", json_schema:{...} }
//     - decoding is constrained to the schema, so output always parses
//   - muse-spark-1.3 standard pricing: $1.25 input / $4.25 output per 1M tokens
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../netlify/functions/_lib
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

export const AI_CONFIG = {
  baseUrl: process.env.META_API_BASE_URL || "https://api.meta.ai/v1",
  apiKey: process.env.META_API_KEY || "",
  // mock = serve saved fixtures (no credits) | live = call Meta Model API
  mode: process.env.AI_MODE === "live" ? "live" : "mock",
  models: {
    // reads photos of notebook pages (image understanding on Muse Spark)
    vision: process.env.META_VISION_MODEL || "muse-spark-1.3",
    // speech to text, used in Stage 6B (file endpoint POST /v1/asr/transcribe)
    transcribe: process.env.META_TRANSCRIBE_MODEL || "muse-voice-transcribe-1.0",
    // boxes/masks for the Stage 5 stretch (may not be needed: Muse Spark
    // grounding already returns normalized 0-1000 boxes - cheaper than SAM)
    segmentation: process.env.META_SEGMENTATION_MODEL || "sam-3.1",
  },
  // muse-spark-1.3, standard mode, USD per 1M tokens (docs/pricing-rate-limits)
  pricingPer1M: { input: 1.25, output: 4.25, cachedInput: 0.15 },
  // Contributor mode (muse-spark-1.3-contributor): $0.10 / $0.20 per 1M -
  // 13-21x cheaper; trades data-usage permission for price.
  contributorModels: { vision: "muse-spark-1.3-contributor" },
};

export function getAiMode() {
  return AI_CONFIG.mode;
}

// ---------------------------------------------------------------- callModel
/**
 * One door to the model.
 *  - mode "mock": serve a saved fixture from /fixtures (mockFixture required), no network.
 *  - mode "live": POST /v1/chat/completions on Meta Model API.
 * Returns { json, content, usage, latencyMs, model }. usage is null in mock mode.
 */
export async function callModel({
  model,
  system,
  userText,
  imageBase64,
  imageMime = "image/jpeg",
  jsonSchema = null,
  schemaName = "Response",
  maxTokens = 4000,
  temperature = 0,
  mockFixture = null,
}) {
  if (AI_CONFIG.mode === "mock") {
    if (!mockFixture) {
      throw new Error(
        "AI_MODE=mock but no mockFixture was passed. Pass one (e.g. 'spike/page1') " +
          "or set AI_MODE=live in .env after adding META_API_KEY.",
      );
    }
    const file = path.join(REPO_ROOT, "fixtures", `${mockFixture}.json`);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`Mock fixture "${mockFixture}" could not be read (${file}): ${e.message}`);
    }
    return { json: parsed, content: JSON.stringify(parsed), usage: null, latencyMs: 0, model: "mock-fixture" };
  }

  // ---- live ----
  if (!AI_CONFIG.apiKey) {
    throw new Error(
      "META_API_KEY is missing. Put it in .env (gitignored) or Netlify env vars, with AI_MODE=live. " +
        "Key comes from the Meta Model API dashboard at https://platform.meta.ai",
    );
  }

  const body = { model, temperature, max_tokens: maxTokens, messages: [] };
  if (system) body.messages.push({ role: "system", content: system });

  const content = [];
  if (userText) content.push({ type: "text", text: userText });
  if (imageBase64) {
    content.push({ type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } });
  }
  // OpenAI-compatible: a plain string when there is only text, array otherwise.
  body.messages.push({
    role: "user",
    content: content.length === 0 ? "" : content.length === 1 && content[0].type === "text" ? content[0].text : content,
  });

  if (jsonSchema) {
    body.response_format = { type: "json_schema", json_schema: { name: schemaName, schema: jsonSchema } };
  }

  const t0 = Date.now();
  const res = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_CONFIG.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // generous; a 1.5k-token JSON reply takes a few seconds
  });
  const latencyMs = Date.now() - t0;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Meta Model API error ${res.status}: ${text.slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message?.content ?? "";
  const usage = {
    input: data?.usage?.prompt_tokens ?? null,
    output: data?.usage?.completion_tokens ?? null,
    cachedInput:
      data?.usage?.prompt_tokens_details?.cached_tokens ??
      (typeof data?.usage?.cached_tokens === "number" ? data.usage.cached_tokens : null),
    // audio page-cost is separate; kept null here (Stage 6B records it itself)
    audioSeconds: null,
  };
  const json = jsonSchema ? parseJsonLoose(message) : null;
  if (jsonSchema && json === null) {
    const err = new Error("Model returned unparseable JSON despite structured output.");
    err.rawContent = message;
    throw err;
  }
  return { json, content: message, usage, latencyMs, model: data?.model ?? model };
}

/** Parse a JSON reply, tolerating markdown fences or stray prose around it. */
export function parseJsonLoose(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {}
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim());
  } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {}
  }
  return null;
}

/** Estimated USD cost for one token-priced call, from AI_CONFIG.pricingPer1M. */
export function estimateCostUSD(usage) {
  if (!usage || usage.input == null || usage.output == null) return null;
  const inTok = Math.max(0, usage.input - (usage.cachedInput ?? 0));
  const cost =
    (inTok / 1e6) * AI_CONFIG.pricingPer1M.input +
    ((usage.cachedInput ?? 0) / 1e6) * AI_CONFIG.pricingPer1M.cachedInput +
    (usage.output / 1e6) * AI_CONFIG.pricingPer1M.output;
  return Math.round(cost * 1e6) / 1e6; // keep 6 decimals (fractions of a cent)
}

// ------------------------------------------------------------- extractPage
/**
 * The one path for notebook-page extraction (spike script now, /extract
 * Netlify function from Stage 1, mock and live).
 * Validates, and on invalid JSON retries ONCE (rule 4), then fails loudly.
 * Returns { extraction, usage, latencyMs, model, retries }.
 */
export async function extractPage({ imageBase64, mime = "image/jpeg", baseDate, fixture = "spike/page1" }) {
  const { buildExtractionSystemPrompt } = await import("./prompts.js");
  const { validateExtraction } = await import("./validate.js");
  const { EXTRACTION_JSON_SCHEMA, EXTRACTION_SCHEMA_NAME } = await import("./prompts.js");
  const t0 = Date.now();

  const attempt = () =>
    callModel({
      model: AI_CONFIG.models.vision,
      system: buildExtractionSystemPrompt(baseDate),
      imageBase64,
      imageMime: mime,
      jsonSchema: EXTRACTION_JSON_SCHEMA,
      schemaName: EXTRACTION_SCHEMA_NAME,
      temperature: 0,
      mockFixture: fixture,
    });

  let res = await attempt();
  let retries = 0;
  let v = validateExtraction(res.json);
  if (!v.ok) {
    retries = 1; // rule 4: retry once
    res = await attempt();
    v = validateExtraction(res.json);
  }
  if (!v.ok) {
    const err = new Error("Extraction JSON failed validation after one retry.");
    err.code = "EXTRACTION_INVALID";
    err.validationErrors = v.errors;
    err.usage = res.usage;
    err.latencyMs = Date.now() - t0;
    throw err;
  }
  return {
    extraction: res.json,
    usage: res.usage,
    latencyMs: Date.now() - t0,
    model: res.model,
    retries,
  };
}
