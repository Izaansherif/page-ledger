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

// Do NOT resolve files via import.meta.url here. The Netlify function bundler
// compiles these modules in a mode where import.meta.url is undefined, which
// crashed every function at load (500/502 with "path argument ... undefined").
// The resolver below works from the repo (dev-server, spike) AND inside the
// deployed bundle: walk up from cwd + env override until a fixtures folder
// shows up next to real demo-voice data.
let _fixturesRoot = null;
function resolveFixturesRoot() {
  if (_fixturesRoot) return _fixturesRoot;
  const envDir = process.env.FIXTURES_DIR;
  const cwd = process.cwd();
  const candidates = [
    envDir,
    cwd,
    path.join(cwd, "netlify", "functions"),
    path.join(cwd, "netlify", "functions", "_lib"),
    path.resolve(cwd, ".."),
    path.resolve(cwd, "..", ".."),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(c, "fixtures")).isDirectory()) {
        _fixturesRoot = c;
        return c;
      }
    } catch {
      // keep walking
    }
  }
  _fixturesRoot = cwd; // fixtures truly absent: per-file read errors explain it
  return _fixturesRoot;
}
export const REPO_ROOT = resolveFixturesRoot();

export const AI_CONFIG = {
  baseUrl: process.env.META_API_BASE_URL || "https://api.meta.ai/v1",
  apiKey: process.env.META_API_KEY || "",
  // mock = serve saved fixtures (no credits) | live = call Meta Model API
  mode: process.env.AI_MODE === "live" ? "live" : "mock",
  models: {
    // reads photos of notebook pages (image understanding on Muse Spark)
    vision: process.env.META_VISION_MODEL || "muse-spark-1.3",
    // text answers for the owner's "Ask my ledger" (Stage 6) - same Spark
    chat: process.env.META_CHAT_MODEL || "muse-spark-1.3",
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

// ----------------------------------------------------- live budget guard
// Section 5 hardening: when AI_MODE=live every call burns real credits, so a
// runaway loop must not be able to torch the key. Two caps, env-tunable, and
// enforced at this one door. Honest limitation: Netlify spawns many
// short-lived function instances, so each instance enforces its own slice -
// this blunts loops and abuse and keeps the default caps far below
// "damage a real key" levels. Sample pages are read from saved fixtures in
// ANY mode (see callModel) and therefore never consume this budget.
const LIVE_BUDGET = {
  perMinute: Math.max(1, Number(process.env.LIVE_CALLS_PER_MINUTE || 8)),
  perDay: Math.max(1, Number(process.env.LIVE_CALLS_PER_DAY || 150)),
};
const budget = { dayStamp: "", dayCount: 0, minuteStamp: "", minuteCount: 0 };

export function assertLiveBudget(kind = "call") {
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const minute = `${day} ${now.slice(11, 16)}`;
  if (budget.dayStamp !== day) {
    budget.dayStamp = day;
    budget.dayCount = 0;
    budget.minuteStamp = "";
    budget.minuteCount = 0;
  }
  if (budget.minuteStamp !== minute) {
    budget.minuteStamp = minute;
    budget.minuteCount = 0;
  }
  const overDay = budget.dayCount >= LIVE_BUDGET.perDay;
  const overMinute = budget.minuteCount >= LIVE_BUDGET.perMinute;
  if (overDay || overMinute) {
    const err = new Error(
      `Live AI budget reached for this ${overDay ? "day" : "minute"} (${kind}): ` +
        `cap is ${LIVE_BUDGET.perMinute}/minute and ${LIVE_BUDGET.perDay}/day. ` +
        "The demo keeps working on its saved sample pages, which cost nothing.",
    );
    err.code = "LIVE_BUDGET_CAPPED";
    throw err;
  }
  budget.dayCount += 1;
  budget.minuteCount += 1;
}

export function liveBudgetSnapshot() {
  return {
    mode: AI_CONFIG.mode,
    caps: LIVE_BUDGET,
    usedToday: budget.dayCount,
    usedThisMinute: budget.minuteCount,
  };
}

// muse-voice-transcribe-1.0: USD 0.18 per hour of processed audio
// (docs/speech-to-text, read 2026-10-26).
const TRANSCRIBE_USD_PER_HOUR = 0.18;

export function estimateTranscribeCostUSD(audioDurationMs) {
  if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) return null;
  return Math.round(((audioDurationMs / 3_600_000) * TRANSCRIBE_USD_PER_HOUR) * 1e6) / 1e6;
}

// ---------------------------------------------------------------- callModel
/**
 * One door to the model.
 *  - mode "mock": serve a saved fixture from /fixtures (mockFixture required), no network.
 *  - mode "live": POST /v1/chat/completions on Meta Model API.
 *  - mockFixture given in ANY mode: the baked sample flow. The extraction JSON
 *    for a bundled sample page is a saved artifact, so it is served without
 *    touching the API - sample reads never spend credits or live budget.
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
  baseDate = null, // {{TODAY±n}} resolution in mock mode
}) {
  if (AI_CONFIG.mode === "mock" || mockFixture) {
    if (!mockFixture) {
      throw new Error(
        "AI_MODE=mock but no mockFixture was passed. Pass one (e.g. 'spike/page1') " +
          "or set AI_MODE=live in .env after adding META_API_KEY.",
      );
    }
    const file = path.join(REPO_ROOT, "fixtures", `${mockFixture}.json`);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new Error(`Mock fixture "${mockFixture}" could not be read (${file}): ${e.message}`);
    }
    // {{TODAY±n}} tokens keep demo follow-up dates believable: resolved against
    // the baseDate the caller says "today" is. Mock-only; never touches live.
    text = text.replace(/\{\{\s*TODAY([+-]\d+)?\s*\}\}/g, (_, off) => {
      const d = new Date(`${baseDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + (off ? parseInt(off, 10) : 0));
      return d.toISOString().slice(0, 10);
    });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Mock fixture "${mockFixture}" is not valid JSON after {{TODAY}} resolution: ${e.message}`);
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

// ------------------------------------------------- transcribeAudio (Stage 4)
/**
 * Voice notes -> transcript text via Muse Voice Transcribe.
 * Facts read from https://dev.meta.ai/docs/speech-to-text on 2026-10-26:
 *   - File endpoint: POST {baseUrl}/asr/transcribe (baseUrl ends in /v1)
 *   - multipart/form-data parts: "request" (JSON, application/json) and
 *     "audio" (RIFF/WAVE, mono 16-bit PCM at 16 or 24 kHz)
 *   - request settings: { mode, model, audioEncoding, languageBias?, keywords? }
 *   - Auth: "Authorization: Bearer <key>" (only the WebSocket ignores the header)
 *   - JSON response: { sessionId, transcript, audioDurationMs, turns[] }
 *   - mode PUSH_TO_TALK returns one complete transcript, turns empty
 *   - caps: body 32 MB, audio 10 min; rate limits -> 429
 * Push-to-talk fits the mic-button UX. Returns { transcript, audioDurationMs,
 * turns, usage: { audioSeconds }, latencyMs, model, retries }.
 */
export async function transcribeAudio({ wavBase64, fixture = "voice/note" }) {
  const t0 = Date.now();

  const validShape = (parsed) =>
    parsed &&
    typeof parsed.transcript === "string" &&
    parsed.transcript.trim().length > 0 &&
    parsed.transcript.length <= 4000 &&
    Array.isArray(parsed.turns ?? []);

  if (AI_CONFIG.mode === "mock") {
    const file = path.join(REPO_ROOT, "fixtures", `${fixture}.json`);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`Mock fixture "${fixture}" could not be read (${file}): ${e.message}`);
    }
    if (!validShape(parsed)) throw new Error(`Mock fixture "${fixture}" has no usable transcript.`);
    return {
      transcript: parsed.transcript,
      audioDurationMs: parsed.audioDurationMs ?? null,
      turns: parsed.turns ?? [],
      usage: parsed.audioDurationMs ? { audioSeconds: Math.floor(parsed.audioDurationMs / 1000) } : null,
      latencyMs: Date.now() - t0,
      model: "mock-fixture",
      retries: 0,
    };
  }

  // ---- live (docs-verified request shape) ----
  if (!AI_CONFIG.apiKey) {
    throw new Error(
      "META_API_KEY is missing. Put it in .env (gitignored) or Netlify env vars, with AI_MODE=live.",
    );
  }
  assertLiveBudget("voice note");
  let wav = null;
  if (wavBase64) {
    try {
      wav = Buffer.from(wavBase64, "base64");
    } catch {
      wav = null;
    }
  }
  if (!wav || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("The recording did not arrive as a WAV file. Tap the mic again and speak once more.");
  }

  const requestPart = {
    mode: "PUSH_TO_TALK",
    model: AI_CONFIG.models.transcribe,
    audioEncoding: "WAV",
    // the shop's languages - biasing only, never forced (docs/speech-to-text)
    languageBias: ["English", "Hindi", "Malayalam"],
  };

  const attempt = async () => {
    const fd = new FormData();
    fd.append("request", new Blob([JSON.stringify(requestPart)], { type: "application/json" }));
    fd.append("audio", new Blob([wav], { type: "audio/wav" }), "note.wav");
    return fetch(`${AI_CONFIG.baseUrl}/asr/transcribe?sessionId=pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AI_CONFIG.apiKey}` },
      body: fd,
      signal: AbortSignal.timeout(120_000),
    });
  };

  let res = await attempt();
  let retries = 0;
  if ((!res.ok && (res.status >= 500 || res.status === 429)) || (res.ok && res.status === 204)) {
    retries = 1; // rule 4: retry once on busy/server trouble
    res = await attempt();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Meta ASR error ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!validShape(data) /* sessionId is optional */) {
    const err = new Error("The transcript came back unreadable despite a valid response.");
    err.status = 502;
    throw err;
  }
  return {
    transcript: data.transcript,
    audioDurationMs: data.audioDurationMs ?? wav.length / (24_000 * 2) * 1000,
    turns: data.turns ?? [],
    usage: data.audioDurationMs ? { audioSeconds: Math.floor(data.audioDurationMs / 1000) } : null,
    latencyMs: Date.now() - t0,
    model: AI_CONFIG.models.transcribe,
    retries,
  };
}

// ---------------------------------------------------------------- askLedger
/**
 * Stage 6 - the OWNER'S question about figures already in their ledger.
 * Facts in use (all previously verified from /docs, unchanged endpoints):
 *   - POST /v1/chat/completions is OpenAI-compatible, has chat model names,
 *     and supports structured output via response_format json_schema.
 * Mock mode: a fixture answer. Live mode: one grounded chat call, answers
 * validated against ASK_JSON_SCHEMA; on invalid JSON retry ONCE (rule 4).
 * Rule 6 holds by construction: the model may reference names/figures, and
 * the UI only displays the answer - it never auto-sends anything to anyone.
 * Returns { answer, basedOn, usage, estCostUSD, latencyMs, model, retries }.
 */
export async function askLedger({ question, brief, fixture = null }) {
  const { ASK_JSON_SCHEMA, ASK_SCHEMA_NAME, buildAskSystemPrompt } = await import("./prompts.js");
  const t0 = Date.now();

  const validShape = (parsed) =>
    parsed &&
    typeof parsed.answer === "string" &&
    parsed.answer.trim().length > 0 &&
    parsed.answer.length <= 700 &&
    Array.isArray(parsed.based_on ?? []);

  // Demo answers are grounded the same way the live model is: they may only
  // cite figures from the sanitized brief. The fixture texts hold {{TOKENS}}
  // that this fills from the owner's real numbers - the demo answer always
  // matches what the People view shows, whatever the visitor saved.
  const rupees = (n) => "\u20b9" + Number(n ?? 0).toLocaleString("en-IN");
  function fillAsk(text) {
    const t = brief?.totals ?? {};
    const call = Array.isArray(brief?.todayCall) ? brief.todayCall : [];
    const chase = call[0] ?? null;
    const chaseName = chase ? chase.name : "nobody";
    const chaseTxt = chase ? `${chase.name} (${String(chase.when ?? "").trim()})` : "nobody yet - confirm a follow-up on a page and they show up here";
    const top = Array.isArray(brief?.topDue) ? brief.topDue[0] ?? null : null;
    const topName = top ? top.name : "nobody";
    const topTxt = top ? `${top.name}, ${rupees(top.due)}` : "nobody owes anything yet";
    const overdueCount = call.filter((p) => /^overdue/.test(String(p.when ?? ""))).length;
    return String(text)
      .replace(/\{\{\s*CHASE_NAME\s*\}\}/g, chaseName)
      .replace(/\{\{\s*CHASE\s*\}\}/g, chaseTxt)
      .replace(/\{\{\s*TOP_NAME\s*\}\}/g, topName)
      .replace(/\{\{\s*TOP\s*\}\}/g, topTxt)
      .replace(/\{\{\s*TODAY_COUNT\s*\}\}/g, String(call.length))
      .replace(/\{\{\s*OVERDUE_COUNT\s*\}\}/g, String(overdueCount))
      .replace(/\{\{\s*DUE\s*\}\}/g, rupees(t.due))
      .replace(/\{\{\s*PAID\s*\}\}/g, rupees(t.paid))
      .replace(/\{\{\s*PEOPLE\s*\}\}/g, String(t.people ?? 0))
      .replace(/\{\{\s*PAGES\s*\}\}/g, String(brief?.pages ?? 1));
  }

  // Exact-match slug map: a visitor's free-text question never builds a path.
  const ASK_FIXTURE_BY_QUESTION = new Map([
    ["Who owes me the most?", "ask/owe"],
    ["How was this week in my ledger?", "ask/week"],
    ["Who should I chase today?", "ask/today"],
  ]);
  const slug = fixture ?? ASK_FIXTURE_BY_QUESTION.get(String(question ?? "").trim()) ?? "ask/summary";

  if (AI_CONFIG.mode === "mock") {
    const file = path.join(REPO_ROOT, "fixtures", `${slug}.json`);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`Mock fixture "${slug}" could not be read (${file}): ${e.message}`);
    }
    if (!validShape(parsed)) throw new Error(`Mock fixture "${slug}" has no usable answer.`);
    return {
      answer: fillAsk(parsed.answer),
      basedOn: (parsed.based_on ?? []).map((s) => fillAsk(String(s))),
      usage: null,
      estCostUSD: null,
      latencyMs: Date.now() - t0,
      model: "mock-fixture",
      retries: 0,
    };
  }

  if (!AI_CONFIG.apiKey) {
    throw new Error(
      "META_API_KEY is missing. Put it in .env (gitignored) or Netlify env vars, with AI_MODE=live.",
    );
  }
  assertLiveBudget("question");

  const userText =
    `Owner's question: ${question}\n\n` +
    `Ledger figures (JSON, computed from the owner's saved pages):\n` +
    JSON.stringify(brief);

  const attempt = () =>
    callModel({
      model: AI_CONFIG.models.chat,
      system: buildAskSystemPrompt(),
      userText,
      jsonSchema: ASK_JSON_SCHEMA,
      schemaName: ASK_SCHEMA_NAME,
      temperature: 0,
      maxTokens: 700,
    });

  let res = await attempt();
  let retries = 0;
  let ok = validShape(res.json);
  if (!ok) {
    retries = 1; // rule 4: retry once
    res = await attempt();
    ok = validShape(res.json);
  }
  if (!ok) {
    const err = new Error("The answer failed validation after one retry.");
    err.code = "ANSWER_INVALID";
    throw err;
  }
  return {
    answer: res.json.answer,
    basedOn: res.json.based_on ?? [],
    usage: res.usage,
    estCostUSD: estimateCostUSD(res.usage),
    latencyMs: Date.now() - t0,
    model: res.model,
    retries,
  };
}

// ---------------------------------------------------------------- extractPage
/**
 * The one path for notebook-page extraction (spike script now, /extract
 * Netlify function from Stage 1, mock and live).
 * Validates, and on invalid JSON retries ONCE (rule 4), then fails loudly.
 * Returns { extraction, usage, latencyMs, model, retries }.
 */
export async function extractPage({ imageBase64, mime = "image/jpeg", baseDate, fixture = null }) {
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
      baseDate,
    });

  let res;
  if (fixture) {
    // A bundled sample page: its JSON is a saved artifact, served in ANY mode,
    // never touching the API and never consuming the live budget.
    res = await attempt();
  } else if (AI_CONFIG.mode === "mock") {
    // Real photo, no key configured: callModel explains what to do. No budget.
    res = await attempt();
  } else {
    // Real photo, live mode: this is the burn. Capped per minute and per day.
    assertLiveBudget("page read");
    res = await attempt();
  }
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
