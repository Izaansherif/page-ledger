// netlify/functions/ask.js
// ---------------------------------------------------------------------------
// /.netlify/functions/ask  (Stage 6: "Ask my ledger")
// The OWNER asks a question about figures already in their ledger. The client
// computes a compact figures brief from the owner's own saved pages and sends
// it with the question; this file only shapes the call - ALL model work lives
// in _lib/ai.js (rule 3). The reply is grounded JSON: answer + the figures it
// used. No message is ever sent to anyone from here (rule 6).
//
// Same Stage-2 gate as extract.js/transcribe.js: when Supabase is configured,
// a valid session token is required.
// ---------------------------------------------------------------------------
import { askLedger, AI_CONFIG, estimateCostUSD } from "./_lib/ai.js";

const MAX_QUESTION_CHARS = 240;
const MAX_BRIEF_CHARS = 6000;

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

// Drops anything unexpected from the client brief and caps sizes. The model
// only ever sees strings/numbers from these whitelisted shapes.
function sanitizeBrief(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const names = Array.isArray(raw.topDue)
    ? raw.topDue
        .slice(0, 6)
        .map((p) => ({ name: String(p?.name ?? "").slice(0, 40), due: num(p?.due) }))
        .filter((p) => p.name)
    : [];
  const today = Array.isArray(raw.today)
    ? raw.today
        .slice(0, 8)
        .map((p) => ({ name: String(p?.name ?? "").slice(0, 40), when: String(p?.when ?? "").slice(0, 24) }))
        .filter((p) => p.name)
    : [];
  const out = {
    today: String(raw.todayDate ?? "").slice(0, 10),
    pages: num(raw.pages) ?? 0,
    totals: {
      due: num(raw.totals?.due) ?? 0,
      paid: num(raw.totals?.paid) ?? 0,
      people: num(raw.totals?.people) ?? 0,
      toCall: num(raw.totals?.toCall) ?? 0,
    },
    topDue: names,
    todayCall: today,
  };
  return JSON.stringify(out).length <= MAX_BRIEF_CHARS ? out : null;
}

export async function handler(event) {
  const method = (event?.httpMethod || event?.requestContext?.http?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return json(405, { ok: false, error: "Send a POST request with your question." });
  }

  const userId = await verifySession(event);
  if (userId === "invalid") {
    return json(401, { ok: false, error: "Please sign in to Page Ledger first - the answers use only your own figures." });
  }

  let req;
  try {
    req = JSON.parse(event?.body ?? "{}");
  } catch {
    return json(400, { ok: false, error: "The request body was not valid JSON." });
  }
  const question = typeof req?.question === "string" ? req.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
  const brief = sanitizeBrief(req?.brief);
  if (!question) {
    return json(400, { ok: false, error: "No question was sent. Pick one of the questions and try again." });
  }
  if (!brief) {
    return json(400, { ok: false, error: "The ledger summary did not arrive correctly. Reload the People page and try again." });
  }

  try {
    const result = await askLedger({ question, brief });
    console.log(
      `[ask] model=${result.model} latency=${result.latencyMs}ms retries=${result.retries} ` +
        (result.usage
          ? `in:${result.usage.input} out:${result.usage.output} estCost=$${estimateCostUSD(result.usage)}`
          : "usage=mock"),
    );
    return json(200, {
      ok: true,
      answer: result.answer,
      basedOn: result.basedOn,
      usage: result.usage,
      estCostUSD: result.estCostUSD,
      model: result.model,
      latencyMs: result.latencyMs,
      retries: result.retries,
      demoMode: AI_CONFIG.mode === "mock",
    });
  } catch (err) {
    console.error("[ask] failed:", err.message);
    if (err.code === "LIVE_BUDGET_CAPPED") {
      // Section 5 fallback: no invented answers - the sample demo keeps working.
      return json(429, {
        ok: false,
        code: "live_budget_capped",
        sampleOnly: true,
        error:
          "Answering questions is part of this demo's live AI budget, which is used up for right now. The saved sample demo below still shows exactly how the answers are grounded.",
      });
    }
    return json(500, {
      ok: false,
      error: "The answer service did not respond. Try once more in a moment.",
      detail: err.message,
    });
  }
}
