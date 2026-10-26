#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scripts/spike-extract.js  (Stage 0)
// Prove that a notebook photo becomes validated structured rows.
//
//   node scripts/spike-extract.js test-pages/page1.jpg            (uses AI_MODE from .env)
//   node scripts/spike-extract.js test-pages/page1.jpg --mock     (fixture, zero credits)
//   node scripts/spike-extract.js test-pages/page1.jpg --live     (force live call)
//   node scripts/spike-extract.js test-pages/page1.jpg --fixture spike/page2
//
// Prints rows as a readable table, latency, token usage and estimated cost,
// and saves the raw response under fixtures/private/ (gitignored).
// ---------------------------------------------------------------------------
import { loadEnv } from "./_lib/env.js";
loadEnv(); // must run before reading AI_CONFIG (dynamic import below)
process.env.AI_MODE = process.env.AI_MODE === "live" ? "live" : "mock";

const { extractPage, AI_CONFIG, getAiMode, estimateCostUSD } = await import("../netlify/functions/_lib/ai.js");
const { buildExtractionSystemPrompt } = await import("../netlify/functions/_lib/prompts.js");

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(HERE, "..", "fixtures", "private");

const argv = process.argv.slice(2);
let imagePath = null;
let forceMock = false;
let forceLive = false;
let fixtureName = "spike/page1";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--mock") forceMock = true;
  else if (argv[i] === "--live") forceLive = true;
  else if (argv[i] === "--fixture") fixtureName = argv[++i];
  else if (!argv[i].startsWith("--")) imagePath = argv[i];
}

if (forceMock) process.env.AI_MODE = "mock";
if (forceLive) process.env.AI_MODE = "live";

const mode = getAiMode();
const now = new Date();
const baseDate =
  `${now.getFullYear()}-` +
  `${String(now.getMonth() + 1).padStart(2, "0")}-` +
  `${String(now.getDate()).padStart(2, "0")}`;

let imageBase64 = null;
let mime = "image/jpeg";
let imageMeta = { path: null, kb: null };

if (mode === "live") {
  if (!imagePath) {
    console.error("\nUsage: node scripts/spike-extract.js <image-path> [--live|--mock]\n");
    process.exit(1);
  }
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) {
    console.error(`\nNo such file: ${abs}`);
    console.error("Put 3 notebook photos in test-pages/ as page1.jpg, page2.jpg, page3.jpg first.\n");
    process.exit(1);
  }
  const ext = path.extname(abs).toLowerCase().replace(".", "");
  const mimeByExt = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  if (!mimeByExt[ext]) {
    console.error(`\nUnsupported image type ".${ext}". Supported: html5 types image/jpeg, image/png, image/webp, image/gif (docs). Rename to .jpg/.png or convert.\n`);
    process.exit(1);
  }
  mime = mimeByExt[ext];
  imageBase64 = fs.readFileSync(abs).toString("base64");
  imageMeta = { path: abs, kb: Math.round((fs.statSync(abs).size / 1024) * 10) / 10 };
}

console.log(`\n=== Page Ledger spike - mode: ${mode} ===`);
console.log(`System prompt BASE_DATE: ${baseDate}`);
console.log(`Prompt characters: ${buildExtractionSystemPrompt(baseDate).length}`);

try {
  const t0 = Date.now();
  const result = await extractPage({ imageBase64, mime, baseDate, fixture: fixtureName });
  const { extraction, usage, retries } = result;
  const estCost = estimateCostUSD(usage);

  // ---- readable table ----
  const pad = (s, n) => {
    s = s == null ? "" : String(s);
    return s.length > n ? s.slice(0, n - 1) + "~" : s + " ".repeat(Math.max(0, n - s.length));
  };
  const money = (n) => (n == null ? "-" : `Rs.${n}`); // ASCII-safe in Windows console

  console.log(
    `\nidx  name${" ".repeat(18)}phone${" ".repeat(11)}paid${" ".repeat(5)}due${" ".repeat(6)}follow-up (text -> date)  conf  flags`,
  );
  for (const r of extraction.rows) {
    const struck = r.struck_out ? "x " : "  ";
    const confs = Object.values(r.confidence ?? {}).filter((v) => typeof v === "number");
    const minConf = confs.length ? Math.min(...confs) : null;
    console.log(
      struck +
        pad(r.row_index, 3) +
        pad(r.name ?? "(unreadable)", 22) +
        pad(r.phone ?? "-", 15) +
        pad(money(r.amount_paid), 9) +
        pad(money(r.amount_due), 9) +
        pad(
          r.follow_up_text
            ? `${r.follow_up_text} -> ${r.follow_up_date ?? "null (confirm by hand)"}`
            : "-",
          26,
        ) +
        pad(minConf == null || Number.isNaN(minConf) ? "-" : minConf.toFixed(2), 6) +
        (r.flags ?? []).join(","),
    );
  }

  // ---- page summary ----
  const active = extraction.rows.filter((r) => !r.struck_out);
  const sumDue = active.reduce((a, r) => a + (r.amount_due ?? 0), 0);
  const sumPaid = active.reduce((a, r) => a + (r.amount_paid ?? 0), 0);
  console.log(`\nRows: ${extraction.rows.length} total, ${active.length} active (${extraction.rows.length - active.length} struck out)`);
  console.log(`Sum read  : paid ${money(sumPaid)}, due ${money(sumDue)}`);
  if (extraction.page_total_written == null) {
    console.log("Written total on page: none detected");
  } else {
    const diff = extraction.page_total_written - sumDue;
    console.log(
      `Written total on page: ${extraction.page_total_written} - ` +
        (Math.abs(diff) > 0.5 ? `MISMATCH (diff ${diff}) - check flagged cells before trusting` : "matches the sum of due amounts"),
    );
  }
  if ((extraction.page_warnings ?? []).length) {
    console.log(`Page warnings: ${extraction.page_warnings.join(" | ")}`);
  }
  for (const r of extraction.rows) {
    const lowConf = Object.entries(r.confidence ?? {}).filter(
      ([, v]) => typeof v === "number" && v < 0.7,
    );
    if (lowConf.length && !r.struck_out) {
      console.log(`Low confidence -> review by hand: row ${r.row_index} (${r.name ?? "(no name)"}): ${lowConf.map(([f, v]) => `${f}=${v}`).join(", ")}`);
    }
  }

  // ---- usage / cost ----
  console.log(`\nLatency: ${result.latencyMs} ms, retries after invalid JSON: ${retries}`);
  if (usage) {
    console.log(
      `Tokens: input ${usage.input}, output ${usage.output}` +
        (usage.cachedInput ? `. Est cost: $${estCost} (standard mode; contributor mode is ~13-21x cheaper)` : "."),
    );
  } else {
    console.log("Mock mode - no tokens billed (fixture served from /fixtures).");
  }

  // ---- save raw response ----
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = imageMeta.path ? path.basename(imageMeta.path, path.extname(imageMeta.path)) : "mock";
  const rawFile = path.join(RAW_DIR, `raw-${base}-${stamp}.json`);
  fs.writeFileSync(
    rawFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        mode,
        image: imageMeta.path,
        imageKB: imageMeta.kb,
        baseDate,
        model: result.model,
        latencyMs: result.latencyMs,
        retries,
        usage,
        estCostUSD: estCost,
        extraction,
      },
      null,
      2,
    ),
  );
  console.log(`Raw response saved to fixtures/private (${path.relative(process.cwd(), rawFile)}).`);
  console.log("\nSpike OK.\n");
} catch (err) {
  console.error(`\nSpike FAILED (${mode} mode):`);
  console.error(err.message);
  if (err.status === 401) console.error("-> 401: the API key is wrong or missing. Check META_API_KEY in .env.");
  if (err.status === 429) console.error("-> 429: rate limit. Wait a moment and retry.");
  if (err.validationErrors) {
    console.error("Validation errors:");
    for (const e of err.validationErrors.slice(0, 12)) console.error(` - ${e}`);
    console.error("(Rule 4: one retry was already attempted.)");
  }
  console.error("");
  process.exit(1);
}
