// netlify/functions/transcribe.js
// ---------------------------------------------------------------------------
// /.netlify/functions/transcribe  (Stage 4: voice follow-ups)
// Receives { audioBase64 } - a RIFF/WAVE recording (mono 16-bit PCM, 24 kHz)
// encoded in the browser from the mic - and returns its transcript via Muse
// Voice Transcribe through _lib/ai.js (rule 3: one AI module).
//
// Verified request facts (https://dev.meta.ai/docs/speech-to-text, 2026-10-26):
// multipart parts request+audio, auth header, JSON response with transcript.
// Limits enforced here: body cap (Netlify keeps bodies small anyway), WAV
// magic check, single retry on 5xx/429 already handled inside the gateway.
//
// Same Stage-2 auth gate as extract.js: when Supabase is configured, a valid
// session token is required; in Stage-1 demo mode anyone on the page can use
// the mic (mock fixture in mock mode).
// ---------------------------------------------------------------------------
import { transcribeAudio, AI_CONFIG, estimateTranscribeCostUSD } from "./_lib/ai.js";

const MAX_WAV_BYTES = 4 * 1024 * 1024; // ~87s of 24 kHz mono 16-bit PCM

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

async function verifySession(event) {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  if (!supabaseUrl.startsWith("https://")) return null; // not configured

  const auth = event?.headers?.authorization || event?.headers?.Authorization || "";
  const token = String(auth).replace(/^Bearer\s+/i, "").trim();
  if (!token) return "invalid";
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_PUBLISHABLE || "",
      },
    });
    if (!res.ok) return "invalid";
    const user = await res.json();
    return user?.id || "invalid";
  } catch {
    return "invalid";
  }
}

export async function handler(event) {
  const method = (event?.httpMethod || event?.requestContext?.http?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return json(405, { ok: false, error: "Send a POST request with the voice note." });
  }

  const userId = await verifySession(event);
  if (userId === "invalid") {
    return json(401, { ok: false, error: "Please sign in to Page Ledger first - your notes are yours." });
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

  const audioBase64 =
    typeof req.audioBase64 === "string" ? req.audioBase64.replace(/^data:[^;]+;base64,/, "") : "";

  // In mock mode the fixture speaks for the demo even before a real recording
  // lands; live mode requires a real WAV.
  if (!audioBase64 && AI_CONFIG.mode !== "mock") {
    return json(400, { ok: false, error: "No voice note was sent. Tap the mic and speak, then try again." });
  }
  if (audioBase64 && audioBase64.length > Math.ceil((MAX_WAV_BYTES * 4) / 3)) {
    return json(413, {
      ok: false,
      error: "The recording is too long. Speak for up to about a minute per follow-up note.",
    });
  }

  try {
    const result = await transcribeAudio({ wavBase64: audioBase64 });
    const costUSD = estimateTranscribeCostUSD(result.audioDurationMs ?? (result.usage?.audioSeconds ?? 0) * 1000);
    console.log(
      `[transcribe] model=${result.model} latency=${result.latencyMs}ms retries=${result.retries} ` +
        `audio=${result.usage?.audioSeconds ?? "n/a"}s costUSD=${costUSD ?? "n/a(mock)"}`,
    );
    return json(200, {
      ok: true,
      transcribed: result.transcript,
      audioDurationMs: result.audioDurationMs,
      turns: result.turns,
      usage: result.usage,
      estCostUSD: costUSD,
      model: result.model,
      latencyMs: result.latencyMs,
      retries: result.retries,
      demoMode: AI_CONFIG.mode === "mock",
    });
  } catch (err) {
    console.error("[transcribe] failed:", err.message);
    const status = err.status ?? 500;
    const friendly =
      status === 401
        ? "The speech service did not accept the key. Check META_API_KEY in Netlify env vars or .env."
        : status === 400 && /WAV/i.test(err.message ?? "")
          ? "The recording did not reach us as a proper file. Tap the mic again and speak once more."
          : status === 429
            ? "The speech service is busy. Wait a few seconds and try again."
            : "The speech service did not respond. You can type the note instead.";
    return json(status >= 400 && status < 600 ? status : 500, { ok: false, error: friendly, detail: err.message });
  }
}
