#!/usr/bin/env node
// scripts/check-model.js
// ============================================================================
// Verify the Muse Spark Open gateway (Modal shared endpoint) BEFORE anything
// else relies on it. Zero dependencies. Run from pagebook/:
//
//   PowerShell:  $env:MODEL_API_KEY = "wk-..."; node scripts/check-model.js
//   (or put MODEL_API_KEY / MODEL_BASE_URL / MODEL_NAME in the gitignored .env)
//
// What it does, in order:
//   1. GET {MODEL_BASE_URL}/models with the key -> prints the EXACT model ids
//      the endpoint serves (nothing guessed from memory). If MODEL_NAME is set
//      it is checked against that list; if not, a single listed model (or one
//      whose id clearly names the Spark family) is used and said so out loud.
//   2. Runs ONE image read of the dental sample (fixtures/made/dental.jpg)
//      through the SAME pipeline the app uses - extractPage(): schema attempt,
//      prompt fallback if the endpoint refuses/ignores response_format,
//      validation, one retry on failure.
//   3. Compares the reading with the saved fixture fixtures/made/dental.json
//      field by field and reports the differences honestly (a different model
//      may legitimately read some lines differently - that is information,
//      not failure).
//   4. Reports tokens and cost. Cost needs MODEL_PRICE_INPUT / MODEL_PRICE_OUTPUT
//      (USD per 1M tokens); without them it says n/a - no price is invented.
//
// The key is NEVER printed. Nothing is written to disk. This script reads.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./_lib/env.js";
loadEnv();

// The check IS a live call: force live mode before ai.js is imported (the
// .env may carry AI_MODE=mock for the dev server).
process.env.AI_MODE = "live";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { extractPage, AI_CONFIG, estimateCostUSD, structuredOutputStatus } = await import(
  `file:///${ROOT.replace(/\\/g, "/")}/netlify/functions/_lib/ai.js`
);

const base = AI_CONFIG.baseUrl;
const key = AI_CONFIG.apiKey;

if (!key) {
  console.log(`
[check-model] Not running: MODEL_API_KEY is not set.

Put the gateway key in the gitignored .env (or Netlify env vars later):

  MODEL_BASE_URL=https://inference.us-west.modal.direct/v1
  MODEL_API_KEY=wk-ID.ws-SECRET
  MODEL_NAME=            # leave empty the first time; this script prints the ids

Then run:  node scripts/check-model.js
`);
  process.exit(0);
}

const mask = (s) => `${String(s).slice(0, 3)}…${String(s).slice(-2)} (len ${String(s).length})`;
console.log(`[check-model] endpoint : ${base}`);
console.log(`[check-model] key      : set, ${mask(key)}`);
if (AI_CONFIG.model) console.log(`[check-model] MODEL_NAME pinned: ${AI_CONFIG.model}`);

/* -------------------------------------------------- 1) list the model ids */
let ids = [];
try {
  const res = await fetch(`${base.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[check-model] GET /models failed: HTTP ${res.status}`);
    console.error(text.slice(0, 600));
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("[check-model] GET /models returned non-JSON:");
    console.error(text.slice(0, 600));
    process.exit(1);
  }
  const list = Array.isArray(data) ? data : (data?.data ?? data?.models ?? []);
  ids = list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  console.log(`[check-model] models served (${ids.length}):`);
  for (const id of ids) console.log(`   - ${id}`);
  if (!ids.length) console.log("   (the endpoint listed none - vision reads may still work; continuing)");
} catch (e) {
  console.error(`[check-model] GET /models could not run: ${e.message}`);
  process.exit(1);
}

// Pick the model to read with.
let model = AI_CONFIG.model || "";
if (model && ids.length && !ids.includes(model)) {
  console.log(`[check-model] NOTE: MODEL_NAME "${model}" is not in the /models list - using it anyway (some gateways serve unlisted ids).`);
}
if (!model) {
  const sparky = ids.filter((id) => /spark/i.test(id));
  if (ids.length === 1) {
    model = ids[0];
    console.log(`[check-model] only one id listed - using it: ${model}`);
  } else if (sparky.length) {
    model = sparky[0];
    console.log(`[check-model] MODEL_NAME unset - using the first Spark-family id: ${model}`);
  } else {
    console.log(`
[check-model] MODEL_NAME is unset and the id to use is not obvious.
Set MODEL_NAME in .env to one of the ids above, then re-run.`);
    process.exit(1);
  }
  process.env.MODEL_NAME = model; // for this process only
}

/* ------------------------- 2) ONE real image read of the dental sample --- */
const imgPath = path.join(ROOT, "fixtures", "made", "dental.jpg");
const b64 = fs.readFileSync(imgPath).toString("base64");
const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

console.log(`\n[check-model] reading fixtures/made/dental.jpg with ${model} …`);
const t0 = Date.now();
let res;
try {
  res = await extractPage({ imageBase64: b64, mime: "image/jpeg", baseDate: today });
} catch (e) {
  console.error(`[check-model] READ FAILED: ${e.message}`);
  if (e.validationErrors) console.error(e.validationErrors.join("\n"));
  process.exit(1);
}
const latency = Date.now() - t0;

const ex = res.extraction;
console.log(`[check-model] image accepted   : yes (${ex.rows.length} rows, ${latency}ms, retries=${res.retries})`);
console.log(`[check-model] model reported   : ${res.model}`);
console.log(`[check-model] schema respected : yes (validator passed)`);
console.log(`[check-model] structured output: ${res.responseFormat} (endpoint state: ${structuredOutputStatus()})`);

/* ------------------------- 3) compare with the saved fixture ------------ */
const fixturePath = path.join(ROOT, "fixtures", "made", "dental.json");
let fixture = null;
try {
  fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (e) {
  console.log(`[check-model] fixture comparison skipped: ${e.message}`);
}
if (fixture) {
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const diffs = [];
  const fRows = fixture.rows ?? [];
  const mRows = ex.rows ?? [];
  if (fRows.length !== mRows.length) {
    diffs.push(`row count: fixture ${fRows.length} vs model ${mRows.length}`);
  }
  const n = Math.min(fRows.length, mRows.length);
  for (let i = 0; i < n; i++) {
    const f = fRows[i];
    const m = mRows[i];
    if (norm(f.name) !== norm(m.name)) diffs.push(`row ${i} name: fixture "${f.name}" vs model "${m.name}"`);
    for (const k of ["amount_paid", "amount_due"]) {
      const a = f[k] ?? null;
      const b = m[k] ?? null;
      if (Number(a) !== Number(b)) diffs.push(`row ${i} ${k}: fixture ${a} vs model ${b}`);
    }
    if (!!f.struck_out !== !!m.struck_out) diffs.push(`row ${i} struck_out: fixture ${!!f.struck_out} vs model ${!!m.struck_out}`);
    if (norm(f.follow_up_text) !== norm(m.follow_up_text)) {
      diffs.push(`row ${i} follow_up_text: fixture "${f.follow_up_text}" vs model "${m.follow_up_text}"`);
    }
  }
  if (Number(fixture.page_total_written ?? null) !== Number(ex.page_total_written ?? null)) {
    diffs.push(`page_total_written: fixture ${fixture.page_total_written} vs model ${ex.page_total_written}`);
  }
  if (diffs.length) {
    console.log(`[check-model] vs saved fixture : ${diffs.length} difference(s) - a different model may read some lines differently:`);
    for (const d of diffs) console.log(`   - ${d}`);
  } else {
    console.log(`[check-model] vs saved fixture : matches on every compared field (${n} rows, names, amounts, struck flags, follow-up text, written total)`);
  }
}

/* ------------------------- 4) tokens and cost --------------------------- */
const u = res.usage;
if (u && (u.input != null || u.output != null)) {
  console.log(`[check-model] tokens          : input=${u.input ?? "?"} output=${u.output ?? "?"}${u.cachedInput ? ` (cached ${u.cachedInput})` : ""}`);
  const cost = estimateCostUSD(u);
  if (cost != null) {
    console.log(`[check-model] est. cost       : $${cost.toFixed(6)} (from MODEL_PRICE_INPUT/MODEL_PRICE_OUTPUT)`);
  } else {
    console.log(`[check-model] est. cost       : n/a - set MODEL_PRICE_INPUT / MODEL_PRICE_OUTPUT (USD per 1M) to compute it; no price is invented`);
  }
} else {
  console.log("[check-model] tokens          : the response carried no usage object (report it to the endpoint operator)");
}

console.log(`
[check-model] Done. If everything above looks right, put MODEL_NAME=${model}
in .env (and the same three MODEL_* vars in Netlify), then record the five
samples:  node scripts/record-fixtures.js
`);
