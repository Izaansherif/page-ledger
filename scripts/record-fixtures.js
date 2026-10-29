#!/usr/bin/env node
// scripts/record-fixtures.js
// ============================================================================
// ONE command to record REAL model readings of the sample pages
// (run it once the gateway key works - verified first by scripts/check-model.js):
//
//   PowerShell:  $env:AI_MODE = "live"; $env:MODEL_API_KEY = "wk-..."; node scripts/record-fixtures.js
//   (MODEL_BASE_URL / MODEL_NAME come from .env or the environment; see
//    scripts/check-model.js for discovering the exact model id)
//
// For ALL FIVE sample pages - the four made-for-demo pages (fixtures/made/*.jpg)
// and the 1860s museum scan (fixtures/demo-pages/page1.jpg) - this sends the
// actual photo through the SAME pipeline the app uses - extractPage(): live
// Muse Spark Open call on the Modal shared endpoint, strict JSON schema (with
// the automatic prompt fallback when the endpoint does not enforce it),
// validation, one retry on failure. The validated output is written as that
// sample's demo fixture (fixtures/made/<id>.json, fixtures/spike/page1.json),
// and the recording facts (date + model + real token cost) go into
// js/recorded-fixtures.js so the sample cards can honestly upgrade their label
// to "Real reading recorded <date> with <model>".
//
// HONESTY RULES (project rules 5 and 7):
// - rows / raw text / amounts / flags / confidences / bboxes are stored
//   verbatim as the model returned them. Nothing is embroidered.
// - follow_up_date is the ONE exception: absolute dates from the recording
//   day are rewritten to {{TODAY±n}} tokens relative to that day, so demo
//   replays stay believable forever (same mechanism the older fixtures use).
//   This is stated in fixtures/made/README.md and in every run's output.
// - Without the gateway key / AI_MODE=live this script changes NOTHING and
//   exits with instructions. It never invents a fake "recording".
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./_lib/env.js";
loadEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { extractPage, AI_CONFIG, estimateCostUSD } = await import(
  `file:///${ROOT.replace(/\\/g, "/")}/netlify/functions/_lib/ai.js`
);
const { MADE_PAGES } = await import(`file:///${ROOT.replace(/\\/g, "/")}/scripts/sample-pages-spec.js`);

// The five samples the picker shows: four made-for-demo pages + the 1860s
// public-domain museum scan (its photo lives in fixtures/demo-pages/).
const SAMPLES = [
  ...MADE_PAGES.map((p) => ({
    slug: `made/${p.id}`,
    image: path.join(ROOT, "fixtures", "made", `${p.id}.jpg`),
  })),
  {
    slug: "spike/page1",
    image: path.join(ROOT, "fixtures", "demo-pages", "page1.jpg"),
  },
];

const isLive = AI_CONFIG.mode === "live" && !!AI_CONFIG.apiKey;
if (!isLive) {
  console.log(`
[record-fixtures] Not running: AI_MODE is "${AI_CONFIG.mode}" and this script
only records REAL model passes (it must never fake one - project rule 7).

When the gateway key works (verify first with:  node scripts/check-model.js ),
run from the pagebook folder:

  PowerShell:  $env:AI_MODE = "live"; $env:MODEL_API_KEY = "wk-..."; node scripts/record-fixtures.js

Until then the demo keeps its clearly-labeled demo fixtures - which is honest
and free.`);
  process.exit(0);
}

const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Absolute follow-up date (or DB-ish string) -> "{{TODAY±n}}" token relative to baseISO.
function toToken(dateStr, baseISO) {
  const ms = Date.parse(`${dateStr}T00:00:00`) - Date.parse(`${baseISO}T00:00:00`);
  if (!Number.isFinite(ms)) return null;
  const days = Math.round(ms / 86400000);
  return days === 0 ? "{{TODAY}}" : days > 0 ? `{{TODAY+${days}}}` : `{{TODAY${days}}}`;
}

// Pass 1 - read every sample into memory and PROVE each read is real before
// a single byte is written. The `fixture` argument must NOT be passed here:
// in ai.js a mockFixture forces the baked-sample path in ANY mode (that is
// what keeps sample picks free for visitors in the live app), so passing one
// records the OLD fixture and labels it "real" - the exact dishonesty this
// script exists to prevent (caught in a real run 2026-10-29: model came back
// as "mock-fixture"). No fixture argument = the live gateway path.
const reads = [];
for (const sample of SAMPLES) {
  const b64 = fs.readFileSync(sample.image).toString("base64");
  process.stdout.write(`[record] ${sample.slug}: sending to ${AI_CONFIG.model || "(MODEL_NAME unset)"} … `);
  const t0 = Date.now();
  const res = await extractPage({
    imageBase64: b64,
    mime: "image/jpeg",
    baseDate: todayISO(),
  });
  if (!res || res.model === "mock-fixture" || !res.usage) {
    console.log(`\n[record] ABORT: ${sample.slug} came back as a MOCK read (model=${res?.model ?? "none"}, usage=${res?.usage ? "present" : "none"}).`);
    console.log("[record] Nothing was written. A real recording is never faked (rule 7).");
    process.exit(1);
  }
  const extraction = res.extraction;

  // apply the single documented rewrite: absolute follow-up dates -> tokens
  let shifted = 0;
  for (const row of extraction.rows) {
    if (row.follow_up_date) {
      const tok = toToken(row.follow_up_date, todayISO());
      if (tok) { row.follow_up_date = tok; shifted += 1; }
    }
  }

  reads.push({ sample, extraction, res, shifted });
  process.stdout.write(
    `ok rows=${extraction.rows.length} model=${res.model} tokensIn=${res.usage?.input ?? "?"} tokensOut=${res.usage?.output ?? "?"} latency=${Date.now() - t0}ms\n`,
  );
}

// Pass 2 - every read proven real: only now write anything.
const results = [];
for (const { sample, extraction, res, shifted } of reads) {
  const cost = estimateCostUSD(res.usage);
  fs.writeFileSync(
    path.join(ROOT, "fixtures", `${sample.slug}.json`),
    JSON.stringify(extraction, null, 2) + "\n",
  );
  results.push({
    id: sample.slug,
    date: todayISO(),
    model: res.model,
    costUSD: cost,
    tokensIn: res.usage?.input ?? null,
    tokensOut: res.usage?.output ?? null,
    structured: res.responseFormat ?? "unknown",
  });
  console.log(`[record] wrote ${sample.slug} (rows=${extraction.rows.length}, follow-up-dates→tokens=${shifted}, structured=${res.responseFormat ?? "unknown"})`);
}

// regenerate js/recorded-fixtures.js - the client reads this to label cards
const recBody = `// js/recorded-fixtures.js
// ============================================================================
// GENERATED by scripts/record-fixtures.js on ${todayISO()} - do not hand-edit.
//
// Each entry: a REAL reading of that sample page, recorded live through the
// Muse Spark Open gateway (Modal shared endpoint) with the app's own
// extraction pipeline - schema-validated, one retry, saved verbatim to
// fixtures/<id>.json (follow-up dates were turned into {{TODAY}} tokens for
// replays, see the script header). model is the exact model id that did the
// reading; cost is the real API cost of that pass in USD (null when no price
// is configured).
// ============================================================================
export const RECORDED = ${JSON.stringify(Object.fromEntries(results.map((r) => [r.id, { date: r.date, model: r.model, costUSD: r.costUSD, tokensIn: r.tokensIn, tokensOut: r.tokensOut }])), null, 2)};
`;
fs.writeFileSync(path.join(ROOT, "js", "recorded-fixtures.js"), recBody);

console.log(`\n[record-fixtures] Done. ${results.length} fixtures updated, js/recorded-fixtures.js regenerated.`);
for (const r of results) {
  console.log(`  ${r.id}  ${r.date}  model=${r.model}  costUSD=${r.costUSD == null ? "?" : r.costUSD.toFixed(4)}  tokensIn=${r.tokensIn} tokensOut=${r.tokensOut}`);
}
console.log(`\nSample cards in the app will now say "Real reading recorded ${todayISO()} with ${results[0]?.model ?? "the model"}" after a reload.`);
