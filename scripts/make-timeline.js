#!/usr/bin/env node
/**
 * make-timeline.js — the REAL build story, straight from git.
 *
 *   node scripts/make-timeline.js
 *
 * Reads `git log --date=short` (every commit, oldest first), groups the
 * subjects by day, and writes js/timeline.json for the home page's
 * "The story of this build" section.
 *
 * Nothing here is invented: if a day has no commits, it does not appear.
 * One-sentence captions in the owner's own words come from
 * js/story-notes.js (see docs/STORY-NOTES.md) — never from this script.
 *
 * Re-run after every commit so the page stays true:
 *   node scripts/make-timeline.js
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "js", "timeline.json");

let raw;
try {
  raw = execFileSync(
    "git",
    ["log", "--date=short", "--pretty=format:%ad%x09%s", "--no-color"],
    { cwd: ROOT, encoding: "utf8" },
  );
} catch (err) {
  console.error("make-timeline.js: could not read git log. Run this inside the pagebook repo.");
  console.error(String(err?.message ?? err));
  process.exit(1);
}

const rows = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf("\t");
    return { date: line.slice(0, tab), subject: line.slice(tab + 1) };
  })
  .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.subject);

// git prints newest first; the story reads oldest -> newest
rows.reverse();

const days = [];
for (const { date, subject } of rows) {
  const last = days[days.length - 1];
  if (last && last.date === date) last.commits.push(subject);
  else days.push({ date, commits: [subject] });
}

const data = {
  // when this file was last regenerated (a stale file can lie about today)
  generatedAt: new Date().toISOString(),
  from: days[0]?.date ?? null,
  days,
  totals: { days: days.length, commits: rows.length },
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8" });

console.log(`make-timeline.js: wrote js/timeline.json`);
console.log(`  ${data.totals.commits} commits over ${data.totals.days} day(s): ${data.from} -> ${days[days.length - 1]?.date ?? "-"}`);
for (const d of days) console.log(`  ${d.date}  ${d.commits.length} commit(s)`);
