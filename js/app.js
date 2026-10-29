// js/app.js
// ===========================================================================
// Page Ledger — Stage 1 controller.
// Views: upload -> loading -> review (or error). When the server reports
// demoMode, the UI says so instead of pretending to be live.
// Stage 1 saves nothing: this screen's job is a trustworthy read + review.
// ===========================================================================
import { resizeImageToJpeg } from "./resize.js";
import { extractPage, transcribeAudio, askLedger } from "./api.js";
import { getConfig } from "./config.js";
import * as sb from "./supabase.js";
import * as demo from "./demo-store.js";
import * as ppl from "./people.js";
import { MicSession, recordingSupported } from "./record.js";
import * as story from "./story.js";
import { RECORDED } from "./recorded-fixtures.js";
import * as coach from "./coach.js";

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  busy: false,
  demoMode: false,   // server said the read is a mock fixture
  demoStore: false,  // no project keys yet -> local demo persistence
  sbConfigured: false,
  saving: false,
  savedPageId: null,
  jpegBlob: null,
  thumbSrc: null,
  lastRequest: null, // { imageBase64, mime, baseDate, mockFixture }
  extraction: null,
  rows: [],
  usage: null,
  estCostUSD: null,
  model: null,
  latencyMs: null,
  retries: null,
};

// auth facade: same interface whether the store is the real cloud or the
// on-device demo store. Honest labels come from the UI (demo badges).
const auth = () => (state.demoStore ? demo : sb);

/* ------------------------------------------------------------- helpers */
const fmtMoney = (n) =>
  n == null || Number.isNaN(n)
    ? "0"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

const digitsOf = (s) => String(s ?? "").replace(/\D+/g, "");

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const FLAG_LABELS = {
  phone_not_10_digits: "phone not 10 digits",
  amount_ambiguous: "amount unclear",
  unreadable: "unreadable",
  struck_out: "crossed out",
};

const FIELD_UNDO_LABELS = {
  name: "name",
  phone: "phone",
  note: "note",
  amountPaid: "amount paid",
  amountDue: "amount due",
  follow: "follow-up date",
};

/* ------------------------------------------------------------- undo toast */
// Every edit, confirm and delete offers one calm Undo. One toast at a time;
// the newest action replaces the old offer (an honest, simple undo stack).
let undoTimer = null;

function showUndo(label, undoFn) {
  const toast = $("#undo-toast");
  if (!toast) return;
  clearTimeout(undoTimer);
  $("#undo-text").textContent = label;
  toast.hidden = false;
  const clear = () => {
    toast.hidden = true;
    clearTimeout(undoTimer);
  };
  $("#undo-btn").onclick = () => {
    clear();
    undoFn();
  };
  $("#undo-x").onclick = clear;
  undoTimer = setTimeout(clear, 5500);
}

/* Browser Back/Forward feels native: every stable view is one history entry
   (loading/error/auth stay transient - they are never history destinations). */
const HISTORY_VIEWS = new Set(["view-landing", "view-upload", "view-picker", "view-review", "view-people"]);
let historySync = false; // popstate re-entry guard

function showView(name) {
  for (const v of ["view-landing", "view-upload", "view-picker", "view-loading", "view-error", "view-review", "view-auth", "view-people"]) {
    $(`#${v}`).hidden = v !== name;
  }
  syncBottomBar(name);
  if (!HISTORY_VIEWS.has(name)) return;
  const target = `#${name.replace("view-", "")}`;
  if (historySync) {
    historySync = false;
    return;
  }
  if (location.hash !== target) history.pushState({ view: name }, "", target);
}

/* ------------------------------------------------- phone bottom action bar */
// One-handed use: on small screens the two actions that matter for the
// current view live in a fixed bar. The buttons MIRROR the real controls
// (same handlers, no duplicated logic). Hidden on wide screens by CSS.
function syncBottomBar(name) {
  const bar = $("#bottombar");
  const p = $("#bar-primary");
  const s = $("#bar-secondary");
  if (!bar || !p || !s) return;
  const conf = {
    "view-upload": { p: ["Samples", () => showView("view-picker")], s: ["Photograph", () => $("#btn-camera").click()] },
    "view-review": { p: [$("#btn-save")?.textContent?.trim() || "Save", () => $("#btn-save").click()], s: ["Back", () => $("#btn-back").click()] },
    "view-people": { p: ["New page", () => $("#btn-people-back").click()], s: null },
  }[name] ?? null;
  if (!conf || (!conf.p && !conf.s)) {
    bar.hidden = true;
    return;
  }
  const set = (btn, def) => {
    if (!def) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.textContent = def[0];
    btn.onclick = def[1];
  };
  set(p, conf.p);
  set(s, conf.s);
  // tuck the bar away while the coach is pointing (it floats at the bottom)
  bar.hidden = !document.getElementById("coach")?.hidden;
}

function setBadge() {
  const badge = $("#mode-badge");
  if (!state.demoMode) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = state.lastRequest?.mockFixture ? "Sample page · demo" : "Demo reading · your photo kept";
}

function resetToUpload() {
  state.busy = false;
  state.demoMode = false;
  micStatus.rowId = null;
  micStatus.mode = null;
  micStatus.message = null;
  mic?.stop({ discard: true }).catch(() => {});
  state.thumbSrc = null;
  state.jpegBlob = null;
  state.savedPageId = null;
  state.saving = false;
  state.lastRequest = null;
  state.extraction = null;
  state.rows = [];
  state.usage = null;
  state.estCostUSD = null;
  state.model = null;
  state.latencyMs = null;
  state.retries = null;
  syncBboxOverlay();
  setBadge();
  resetSaveUi();
  showSignedInHome();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------- row view-model */
function makeRow(src = {}) {
  const conf = src.confidence ?? {};
  return {
    id: childrenUid(),
    raw: src.raw_text ?? null,
    struckOut: !!src.struck_out,
    included: !src.struck_out,
    flags: [...(src.flags ?? [])],
    fields: {
      name:       { value: src.name ?? "", conf: conf.name ?? null, edited: false },
      phone:      { value: src.phone ?? "", conf: conf.phone ?? null, edited: false },
      note:       { value: src.note ?? "", conf: null, edited: false },
      amountPaid: { value: src.amount_paid ?? null, conf: conf.amount_paid ?? null, edited: false },
      amountDue:  { value: src.amount_due ?? null, conf: conf.amount_due ?? null, edited: false },
    },
    // normalized [x, y, w, h] in 0-1000 page coordinates (tap row -> find the
    // line on the photo). Absent for pages/rows the model could not locate.
    bbox: Array.isArray(src.bbox) && src.bbox.length === 4 ? [...src.bbox] : null,
    ok: !!src.ok, // owner marked this row as checked (one-tap confirm)
    follow: {
      text: src.follow_up_text ?? null,
      date: src.follow_up_date ?? null,
      conf: conf.follow_up_date ?? null,
      confirmed: false,
      edited: false,
    },
  };
}

const childrenUid = () => Math.random().toString(36).slice(2, 10);

function rowsFromExtraction(extraction) {
  return (extraction.rows ?? []).map((r) => makeRow(r));
}

/* ------------------------------------------------------------ rendering */
const activeRows = () => state.rows.filter((r) => r.included);

function balances() {
  let paid = 0;
  let due = 0;
  for (const r of activeRows()) {
    due += Number(r.fields.amountDue.value) || 0;
    paid += Number(r.fields.amountPaid.value) || 0;
  }
  return { paid, due };
}

let lastTotalsSig = "";
function updateTotals() {
  const names = new Set(
    activeRows()
      .map((r) => (r.fields.name.value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const b = balances();
  const sig = `${names.size}|${b.paid}|${b.due}|${activeRows().length}`;
  if (sig === lastTotalsSig) return;
  lastTotalsSig = sig;
  const n = activeRows().length;
  $("#review-summary").textContent = `${names.size} ${names.size === 1 ? "person" : "people"} · ${n} ${n === 1 ? "line" : "lines"} · due ₹${fmtMoney(b.due)} — check line by line with the photo, then confirm`;
  $("#review-totals").innerHTML = `
    <span class="stat"><span class="stat__label">People</span><span class="stat__value">${names.size}</span></span>
    <span class="stat"><span class="stat__label">Paid</span><span class="stat__value">&#8377;${fmtMoney(b.paid)}</span></span>
    <span class="stat"><span class="stat__label">Due</span><span class="stat__value">&#8377;${fmtMoney(b.due)}</span></span>`;
  // Stage-polish: totals count up once per review entry, not on every edit
  if (state.animateTotalsNext) {
    state.animateTotalsNext = false;
    animateCounts($("#review-totals"));
  }
}

/* ------------------------------------------------- motion: gentle count-up */
// Calm ripple of numbers arriving (People chips, review totals). Skipped for
// reduced-motion users - final values render immediately (honest, no flash).
function animateCounts(root) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduced || !root) return;
  for (const el of root.querySelectorAll("strong, .stat__value")) {
    const m = String(el.textContent).match(/^(₹)?([\d,]+)$/);
    if (!m) continue;
    const target = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) continue;
    const prefix = m[1] ?? "";
    const t0 = performance.now();
    const DURATION = 550; // one calm beat
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DURATION);
      const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
      const val = Math.round(target * eased);
      el.textContent = `${prefix}${val.toLocaleString("en-IN")}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function fieldClasses(row, key) {
  const f = row.fields[key];
  const classes = ["field"];
  if (key === "phone") {
    // Red: a number was read/typed but is invalid (not 10 digits).
    // An empty phone is "nothing read" -> amber, not red, so a page without
    // phones doesn't light every row red.
    const n = digitsOf(f.value).length;
    if (n > 0 && n !== 10) classes.push("field--bad");
    else if (!f.edited && (n === 0 || f.conf == null || f.conf < 0.7)) classes.push("field--low");
  } else if (key === "name") {
    // Amber: low confidence, or no name at all (can't book a customer without one).
    const empty = f.value == null || String(f.value).trim() === "";
    if (!f.edited && (empty || f.conf == null || f.conf < 0.7)) classes.push("field--low");
  } else if (key === "amountPaid" || key === "amountDue") {
    // Amber only when the AI graded the read itself unsure. A missing amount
    // is normal on payment/note lines (no due to read), so null is not amber.
    if (!f.edited && f.conf != null && f.conf < 0.7) classes.push("field--low");
  }
  // note: the extraction schema gives notes no confidence, so notes never amber
  return classes.join(" ");
}

function hintFor(row, key) {
  const f = row.fields[key];
  if (key === "phone") {
    const n = digitsOf(f.value).length;
    if (n > 0 && n !== 10) return `needs 10 digits - currently ${n}`;
    if (!f.edited && f.conf != null && f.conf < 0.7) return "low confidence - double-check";
    if (n === 0) return "no phone on this line - fine to leave empty";
    return "";
  }
  if ((key === "amountPaid" || key === "amountDue") && (f.value == null || f.value === "")) {
    return "empty - add if needed";
  }
  if (f && f.conf != null && f.conf < 0.7) {
    return f.edited ? "" : `low confidence (${f.conf.toFixed(2)})`;
  }
  return "";
}

function lowClassForFollow(row) {
  const fol = row.follow;
  if (fol.confirmed) return "field--confirmed";
  // Amber only when something is genuinely unsure: the page named a follow-up
  // ("after 2 weeks") without a certain date, or the date itself was low-confidence.
  const unsure =
    !fol.edited &&
    ((fol.text && !fol.date) || (fol.date && fol.conf != null && fol.conf < 0.7));
  return unsure ? "field--low" : "";
}

function hintForFollow(row) {
  const fol = row.follow;
  if (fol.confirmed) return fol.date ? `Confirmed ${fol.date}` : "Confirmed";
  if (fol.text) return fol.date ? `\u201C${fol.text}\u201D - planned ${fol.date}, confirm it` : `\u201C${fol.text}\u201D - as written, pick a date`;
  if (fol.date) return fol.edited ? "confirm this date" : "date read from the page - confirm it";
  return "no follow-up on this line";
}

function escapeAttr(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHTML(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function niceDay(day) {
  // "2026-10-26" -> "Sun 26 Oct" (kept mild; unknown input passes through)
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day || "";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function inputHTML(row, key, label, type) {
  const isMoney = key === "amountPaid" || key === "amountDue";
  const value = key === "follow" ? row.follow.date : row.fields[key].value;
  const classes =
    key === "follow"
      ? ["field", lowClassForFollow(row)].filter(Boolean).join(" ")
      : fieldClasses(row, key);
  const hint = key === "follow" ? hintForFollow(row) : hintFor(row, key);
  const extras =
    isMoney
      ? 'inputmode="decimal" min="0" step="any"'
      : key === "phone"
        ? 'inputmode="numeric" autocomplete="off" maxlength="15"'
        : "";
  return `<div class="${classes}" data-part="${key}">
    <label>${label}</label>
    <input type="${type}" data-act="edit" data-id="${row.id}" data-key="${key}" value="${escapeAttr(value ?? "")}" ${extras} />
    <span class="hint">${hint}</span>
  </div>`;
}

function rowCardHTML(row, index, noAnim = false) {
  const flagsHTML = (row.flags ?? [])
    .filter((fl) => fl !== "struck_out")
    .map((fl) => `<span class="flag">${FLAG_LABELS[fl] ?? escapeAttr(fl)}</span>`)
    .join("");

  const struckToggle = row.struckOut
    ? `<label class="included-toggle"><input type="checkbox" data-act="include" data-id="${row.id}" ${row.included ? "checked" : ""}/> keep</label>`
    : "";

  const rawBtn = row.raw
    ? `<button class="raw-toggle" type="button" data-act="raw" data-id="${row.id}" aria-expanded="false" title="Show the line as written on the page">see line</button>`
    : "";

  // one-tap "this row is right" + confidence dot (lowest field confidence)
  const confs = ["name", "phone", "amountPaid", "amountDue", "follow"]
    .map((k) => (k === "follow" ? row.follow.conf : row.fields[k]?.conf))
    .filter((c) => typeof c === "number");
  const minConf = confs.length ? Math.min(...confs) : null;
  const dotCls = minConf == null ? " conf-dot--na" : minConf >= 0.75 ? " conf-dot--hi" : minConf >= 0.5 ? " conf-dot--mid" : " conf-dot--low";
  const okBtn = `<button class="row-ok${row.ok ? " row-ok--on" : ""}" type="button" data-act="rowok" data-id="${row.id}" ${
    row.ok ? "" : 'title="Mark this line as checked"'
  } aria-pressed="${row.ok}" aria-label="Confirm this row"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12.5l4.6 4.6L19.5 7.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;

  const rawLine = row.raw
    ? `<p class="rawline" data-rawid="${row.id}" hidden><code>${escapeAttr(row.raw)}</code></p>`
    : "";

  // reveal: first paint after a read staggers lines one by one (capped);
  // every later repaint is instant
  const delayVar = state.reveal ? `;--d:${Math.min(index * 90, 1050)}ms` : "";

  return `
  <div class="rowcard${row.struckOut ? " struck" : ""}${row.ok ? " is-ok" : ""}${noAnim ? " no-anim" : ""}" role="listitem"${noAnim ? "" : ` style="--i:${index}${delayVar}"`} data-id="${row.id}">
    <div class="rowcard__top">
      <span class="rowcard__num"><i class="conf-dot${dotCls}" title="How sure the read is" aria-hidden="true"></i>${index + 1}</span>
      <div class="rowcard__flags">${flagsHTML}</div>
      <div class="rowcard__tools">${okBtn}${struckToggle}${rawBtn}
        <button class="row-del" type="button" data-act="del" data-id="${row.id}" title="Remove this row" aria-label="Remove this row">&#10005;</button>
      </div>
    </div>
    <div class="fields">
      ${inputHTML(row, "name", "Name", "text")}
      ${inputHTML(row, "phone", "Phone", "tel")}
      ${inputHTML(row, "note", "Note", "text")}
      ${inputHTML(row, "amountPaid", "Paid &#8377;", "number")}
      ${inputHTML(row, "amountDue", "Due &#8377;", "number")}
      <div class="followup-row">
        ${inputHTML(row, "follow", "Follow-up", "date")}
        <label class="followup-confirm"><input type="checkbox" data-act="confirm-follow" data-id="${row.id}" ${row.follow.confirmed ? "checked" : ""}/> Confirm</label>
        <div class="field followup-note" data-part="followText">
          <label>Note said</label>
          <input type="text" data-act="edit" data-id="${row.id}" data-key="followText" value="${escapeAttr(row.follow.text ?? "")}" placeholder="tap the mic and say it" />
          <span class="hint${micStatusHint(row).isError ? " hint--err" : ""}">${micStatusHint(row).text}</span>
        </div>
        <button class="mic-btn${micStatusHint(row).cls}" type="button" data-act="mic" data-id="${row.id}" ${micBtnDisabled(row)} title="Speak a follow-up note (tap again to stop)" aria-label="Speak a follow-up note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="4" width="6" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 12a6 6 0 0 0 12 0M12 18v3M9.5 21h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      ${rawLine}
    </div>
  </div>`;
}

/* re-render one row card in place, restoring focus + caret to the edited input */
/* ------------------------------------------------------- mic (Stage 4) */
const micStatus = { rowId: null, mode: null, message: null };

function micStatusHint(row) {
  if (micStatus.rowId !== row.id) return { text: "speak it or type it", cls: "", isError: false };
  if (micStatus.mode === "recording") return { text: "listening… tap the mic to stop", cls: " mic-btn--rec", isError: false };
  if (micStatus.mode === "transcribing") return { text: "checking your voice note…", cls: " mic-btn--busy", isError: false };
  if (micStatus.mode === "error") return { text: micStatus.message || "The mic did not work - type the note.", cls: " mic-btn--err", isError: true };
  if (micStatus.mode === "desc") return { text: micStatus.message || "", cls: "", isError: false };
  return { text: "speak it or type it", cls: "", isError: false };
}

function micBtnDisabled(row) {
  return micStatus.rowId && micStatus.rowId !== row.id ? "disabled" : "";
}

let mic = null;

async function handleMic(rowId) {
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;

  // second tap on the same row = stop and transcribe
  if (micStatus.rowId === rowId && micStatus.mode === "recording") {
    micStatus.mode = "transcribing";
    refreshRow(rowId);
    try {
      const { wavBase64, durationMs } = await mic.stop();
      const token = auth().getSession()?.access || null;
      const res = await transcribeAudio({ wavBase64: durationMs > 250 ? wavBase64 : null, token });
      row.follow.text = res.transcribed;
      row.follow.edited = true; // it came from the owner's own voice
      micStatus.rowId = rowId;
      micStatus.mode = "desc";
      micStatus.message = res.demoMode ? "Demo transcript filled - edit it to your words." : "Whispered words filled - check and edit.";
      refreshRow(rowId, "followText");
    } catch (e) {
      micStatus.rowId = rowId;
      micStatus.mode = "error";
      micStatus.message = e?.message || "The mic did not work - type the note.";
      refreshRow(rowId);
    }
    return;
  }

  // first tap = start recording
  if (!mic) mic = new MicSession();
  try {
    await mic.start();
    micStatus.rowId = rowId;
    micStatus.mode = "recording";
    micStatus.message = null;
    refreshRow(rowId);
  } catch (e) {
    micStatus.rowId = rowId;
    micStatus.mode = "error";
    micStatus.message = e?.message || "The mic did not work - type the note.";
    refreshRow(rowId);
  }
}

function refreshRow(id, focusKey = null) {  const idx = state.rows.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const card = $(`#rows .rowcard[data-id="${id}"]`);
  if (!card) return;
  const active = document.activeElement;
  const keep = focusKey || (active?.dataset?.id === id ? active.dataset.key : null);
  const selStart = active?.selectionStart ?? null;
  const selEnd = active?.selectionEnd ?? null;
  card.outerHTML = rowCardHTML(state.rows[idx], idx, true);
  if (keep) {
    const el = $(`#rows .rowcard[data-id="${id}"] input[data-key="${keep}"]`);
    if (el) {
      el.focus({ preventScroll: false });
      try { el.setSelectionRange(selStart, selEnd); } catch {}
    }
  }
  updateTotals();
}

function renderRows() {
  const container = $("#rows");
  if (!state.rows.length) {
    container.innerHTML = $("#tpl-empty").innerHTML;
    container.classList.remove("revealing");
    syncBboxOverlay();
    return;
  }
  container.classList.toggle("revealing", !!state.reveal);
  container.innerHTML = state.rows.map((r, i) => rowCardHTML(r, i)).join("");
  if (state.reveal) {
    state.reveal = false; // this paint only
    setTimeout(() => container.classList.remove("revealing"), 1400);
  }
  syncBboxOverlay();
}

function renderWarnings(extraction) {
  const el = $("#warnings");
  const w = extraction?.page_warnings ?? [];
  const total = extraction?.page_total_written;
  const items = [...w.map((x) => `<li>${escapeAttr(x)}</li>`)];
  if (total != null) {
    items.push(
      `<li>Written total on the page: <strong>&#8377;${fmtMoney(total)}</strong> - make sure the rows add up to about this. The check against every kept row lives in &ldquo;How this page was read&rdquo;.</li>`,
    );
  }
  if (items.length) {
    el.innerHTML = `<ul>${items.join("")}</ul>`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/* ---------------------------------------------- photo ↔ row locate (bbox) */
// Rows can carry a normalized [x,y,w,h] (0-1000) position on the photo.
// A tap on a row highlights that line ON the photo; a tap on a highlighted
// photo area scrolls to its row. Everything degrades silently when the
// boxes are missing (older pages) - the zoom flow still works.

function photoBoxMapping() {
  const img = $("#thumb-img");
  const box = $("#photo-box");
  if (!img || !box || !img.naturalWidth) return null;
  const bw = box.clientWidth;
  const bh = box.clientHeight;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  // .photo-thumb img uses object-fit: cover with object-position: top:
  // one scale, horizontal center-crop, anchored to the top edge
  const scale = Math.max(bw / nw, bh / nh);
  const offX = (bw - nw * scale) / 2;
  const offY = 0;
  return { bw, bh, scale, offX, offY };
}

function bboxToClientRect(bbox) {
  const m = photoBoxMapping();
  if (!m) return null;
  const nw = $("#thumb-img").naturalWidth;
  const nh = $("#thumb-img").naturalHeight;
  const x = Math.round((bbox[0] / 1000) * nw * m.scale - m.offX);
  const y = Math.round((bbox[1] / 1000) * nh * m.scale - m.offY);
  const w = Math.round((bbox[2] / 1000) * nw * m.scale);
  const h = Math.round((bbox[3] / 1000) * nh * m.scale);
  // outside the visible crop -> not highlightable right now
  if (x + w <= 0 || y + h <= 0 || x >= m.bw || y >= m.bh) return null;
  return { x, y, w, h };
}

function syncBboxOverlay() {
  const wrap = $("#photo-bbox");
  if (!wrap) return;
  const layout = state.rows
    .map((r) => ({ id: r.id, rect: r.bbox ? bboxToClientRect(r.bbox) : null }))
    .filter((e) => e.rect);
  const box = $("#photo-box");
  if (!layout.length || !box?.clientWidth) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    box?.classList.remove("photo-locate");
    return;
  }
  wrap.hidden = false;
  box.classList.add("photo-locate");
  wrap.innerHTML = layout
    .map(({ id, rect }) => {
      const idAttr = escapeAttr(id);
      return `<span class="bbox-line" data-row="${idAttr}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px" title="This row in the table"></span>`;
    })
    .join("");
}

function highlightRowOnPhoto(rowId, { scroll = false } = {}) {
  const span = document.querySelector(`.bbox-line[data-row="${CSS.escape(rowId)}"]`);
  if (!span) return false;
  document.querySelectorAll(".bbox-line--hot").forEach((s) => s.classList.remove("bbox-line--hot"));
  span.classList.add("bbox-line--hot");
  if (scroll) span.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

function rowOnPhotoHighlight(rowId) {
  // tap a ROW -> the photo shows where that line is
  if (!highlightRowOnPhoto(rowId)) return;
  const card = $(`#rows .rowcard[data-id="${rowId}"]`);
  card?.classList.add("row-flash");
  setTimeout(() => card?.classList.remove("row-flash"), 900);
}

function photoRowAt(clientX, clientY) {
  // tap the photo -> the row whose line is nearest the tap point
  const box = $("#photo-box").getBoundingClientRect();
  let best = null;
  let bestD = Infinity;
  for (const r of state.rows) {
    if (!r.bbox) continue;
    const rect = bboxToClientRect(r.bbox);
    if (!rect) continue;
    const cx = box.left + rect.x + rect.w / 2;
    const cy = box.top + rect.y + rect.h / 2;
    const dx = Math.max(0, Math.abs(clientX - cx) - rect.w / 2);
    const dy = Math.max(0, Math.abs(clientY - cy) - rect.h / 2);
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

function renderReview() {
  setBadge();
  // the view must be visible BEFORE painting rows: the reveal animation and
  // the photo-line overlay both measure real layout
  showView("view-review");
  state.reveal = true; // first paint: lines appear one by one (renderRows clears it)
  renderRows();
  renderWarnings(state.extraction);
  updateReadbox();
  state.animateTotalsNext = true;
  updateTotals();
  resetSaveUi();
  // What am I looking at: a bundled sample, or my own photo in demo mode?
  const banner = $("#demo-banner");
  if (state.demoMode) {
    banner.hidden = false;
    banner.textContent = state.lastRequest?.mockFixture
      ? "Sample page - the demo AI read a bundled example so you can try everything without a real photo or key."
      : "Demo reading - your photo stays in the app, but the rows below come from the sample. Real photo reading switches on when the project key is connected.";
  } else {
    banner.hidden = true;
  }
  setStageNotes();
  window.scrollTo(0, 0);
  coach.reach("review");
}

/* --------------------------------------------------- grounded read details */
// Stage 5: the honesty panel. Counts what the read actually produced - kept
// lines, struck lines, blank fields, check-flags, page-level notes - plus the
// technical receipt (model, latency, retries, tokens, cost). Nothing invented:
// everything here is derived from the extraction object and the server reply.
function updateReadbox() {
  const box = $("#readbox");
  const ex = state.extraction;
  if (!box || !ex) {
    if (box) box.hidden = true;
    return;
  }
  const rows = ex.rows ?? [];
  const kept = rows.filter((r) => !r.struck_out).length;
  const struck = rows.length - kept;

  const blanks = { name: 0, phone: 0, amount_paid: 0, amount_due: 0 };
  let confCount = 0;
  let confSum = 0;
  let flagsCount = 0;
  for (const r of rows) {
    for (const k of Object.keys(blanks)) if (r[k] == null) blanks[k]++;
    const c = r.confidence ?? {};
    for (const k of ["name", "phone", "amount_paid", "amount_due", "follow_up_date"]) {
      if (typeof c[k] === "number") {
        confCount++;
        confSum += c[k];
      }
    }
    flagsCount += (r.flags ?? []).length;
  }
  const blanksTotal = blanks.name + blanks.phone + blanks.amount_paid + blanks.amount_due;
  const avg = confCount ? Math.round((confSum / confCount) * 100) : null;
  const warns = ex.page_warnings ?? [];

  const tech = [
    state.model ? `model ${state.model}` : null,
    state.latencyMs != null ? `${(state.latencyMs / 1000).toFixed(1)}s read time` : null,
    state.retries ? `${state.retries} retr${state.retries === 1 ? "y" : "ies"}` : null,
    state.usage ? `${state.usage.input} + ${state.usage.output} tokens` : null,
    state.estCostUSD != null ? `≈ $${state.estCostUSD} this read` : "no charge (demo fixture)",
  ]
    .filter(Boolean)
    .join(" · ");

  $("#readbox-body").innerHTML = `
    <div class="readbox__grid">
      <span><strong>${kept}</strong> line${kept === 1 ? "" : "s"} kept for your check</span>
      ${struck ? `<span><strong>${struck}</strong> struck out and excluded</span>` : ""}
      ${blanksTotal ? `<span><strong>${blanksTotal}</strong> field${blanksTotal === 1 ? "" : "s"} left blank - not stated (or unclear) on the page; fill any you know</span>` : ""}
      ${avg != null ? `<span>reading confidence ≈ <strong>${avg}%</strong> over ${confCount} value${confCount === 1 ? "" : "s"}</span>` : ""}
      ${flagsCount ? `<span><strong>${flagsCount}</strong> check-flag${flagsCount === 1 ? "" : "s"} marked for your eye</span>` : ""}
      ${warns.length ? `<span><strong>${warns.length}</strong> whole-page note${warns.length === 1 ? "" : "s"} (in the yellow box)</span>` : ""}
    </div>
    <p class="readbox__tech">${escapeHTML(tech)}</p>
    <p class="readbox__honest">${
      state.demoMode
        ? (state.lastRequest?.mockFixture
            ? "Demo read: this sample page is read by fixture, so nothing is charged - the rows are stand-in data, clearly re-labeled, never invented live."
            : "Demo read: no key yet, so these rows are stand-in sample data - your own photo is kept and the same photo reads for real once the project key is connected.")
        : "Nothing is invented: a field stays empty unless the page really shows it, and every line waits for your check before saving."
    }</p>
  `;
  box.hidden = false;
}

/* ---------------------------------------------------------- extraction */
const PHASES = [
  "Finding the columns\u2026",
  "Reading names and phones\u2026",
  "Checking the amounts\u2026",
  "Marking what needs your eye\u2026",
];

function startPhases() {
  let i = 0;
  $("#loading-phase").textContent = PHASES[0];
  const timer = setInterval(() => {
    i = (i + 1) % PHASES.length;
    $("#loading-phase").textContent = PHASES[i];
  }, 420);
  return () => clearInterval(timer);
}

let stopPhases = null;

// Same-photo cache: reading the IDENTICAL photo again this session re-serves
// the first read's exact result instead of running the pipeline twice. Key =
// sampled digest of the image payload + page date (+ fixture for samples).
// In memory only - closing the tab forgets it, nothing is stored anywhere.
const readCache = new Map(); // key -> response body
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 997) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) | 0;
  }
  return (s.length >>> 0).toString(36) + ":" + (h >>> 0).toString(36) + ":" + s.slice(-48);
}
function readKey(request) {
  return [
    request.imageBase64 ? hashStr(request.imageBase64) : "noimg",
    request.mime ?? "",
    request.mockFixture ?? "",
    request.baseDate ?? "",
  ].join("|");
}
function cachePut(key, res) {
  if (readCache.size >= 8) readCache.delete(readCache.keys().next().value);
  readCache.set(key, res);
}

async function runExtraction(request) {
  // Stage 2 gate: with Supabase configured, reading requires a signed-in user
  // (matching the server, which rejects unauthenticated reads).
  if ((state.sbConfigured || state.demoStore) && !auth().getSession()) {
    showAuth();
    return;
  }
  state.busy = true;
  state.lastRequest = request;
  state.demoMode = !!request.mockFixture;
  setBadge();
  $("#loading-title").textContent = "Reading your page\u2026";
  showView("view-loading");
  stopPhases = startPhases();

  const t0 = performance.now();
  try {
    const key = readKey(request);
    const cached = readCache.get(key);
    let res;
    if (cached) {
      // Second look at the same photo: instant, honest note in the console -
      // the pipeline is not run twice for what this browser already read.
      res = cached;
      console.log(
        `[read-cache] same photo re-served from this session's earlier read ` +
          `(${request.baseDate ? "page " + request.baseDate + ", " : ""}` +
          `${request.mockFixture ? "sample" : "own photo"})`,
      );
    } else {
      res = await extractPage(request, auth().getSession()?.access || null);
      cachePut(key, res);
    }
    const elapsed = performance.now() - t0;
    const wait = Math.max(0, (cached ? 260 : 1200) - elapsed); // a deliberate beat, so the demo doesn't look fake-fast
    if (wait) await new Promise((r) => setTimeout(r, wait));

    state.extraction = res.extraction;
    state.rows = rowsFromExtraction(res.extraction);
    state.usage = res.usage;
    state.estCostUSD = res.estCostUSD ?? null;
    state.model = res.model ?? null;
    state.latencyMs = res.latencyMs ?? null;
    state.retries = res.retries ?? 0;
    state.demoMode = !!res.demoMode;
    setBadge();

    // requirement (Stage 1 #8): usage + estimated cost per page in the console
    console.log(
      `[page] model=${state.model} latency=${state.latencyMs}ms retries=${state.retries} ` +
        `usage=${state.usage ? `in:${state.usage.input} out:${state.usage.output}${state.usage.cachedInput ? ` cached:${state.usage.cachedInput}` : ""}` : "mock (no tokens)"} ` +
        `estCost=${state.estCostUSD != null ? `$${state.estCostUSD}` : "n/a (mock)"}`,
    );

    renderReview();
  } catch (err) {
    $("#error-msg").textContent = err.message || "Something went wrong while reading the page.";
    const d = $("#error-detail");
    if (err.detail) {
      d.hidden = false;
      d.textContent = `Detail: ${String(err.detail).slice(0, 280)}`;
    } else if (err.sampleOnly) {
      // Sample-fallback endings (live-budget cap, or an own photo in demo
      // mode): end on the samples, never a dead end.
      d.hidden = false;
      d.textContent =
        err.code === "mock_needs_fixture"
          ? "The saved sample pages read fully in this demo and cost nothing - go back and tap one of them."
          : "The saved sample pages are not affected by the budget - go back and tap one of the sample pages.";
    } else {
      d.hidden = true;
      d.textContent = "";
    }
    showView("view-error");
  } finally {
    if (stopPhases) stopPhases();
    stopPhases = null;
    state.busy = false;
  }
}

/* --------------------------------------------------------------- files */
async function handleSelectedFile(fileLike, opts = {}) {
  if (state.busy) return;
  try {
    const { blob, base64, mime, width, height, kb } = await resizeImageToJpeg(fileLike);
    state.jpegBlob = blob;
    state.thumbSrc = `data:image/jpeg;base64,${base64}`;
    state.savedPageId = null;
    state.saving = false;
    $("#thumb-img").src = state.thumbSrc;
    $("#thumb-img").onload = () => syncBboxOverlay(); // boxes can render once the photo has dimensions
    console.log(`[upload] resized to ${width}x${height}, ${kb} KB, mime=${mime}`);
    await runExtraction({
      imageBase64: base64,
      mime,
      baseDate: todayISO(),
      mockFixture: opts.mockFixture ?? null,
    });
  } catch (e) {
    $("#error-msg").textContent = e.message || "That file could not be used.";
    $("#error-detail").hidden = true;
    showView("view-error");
  }
}

/* ============================================================ Stage 2 === */
function signedInNow() {
  return !!auth().getSession();
}

function setStageNotes() {
  const signedIn = (state.sbConfigured || state.demoStore) && signedInNow();
  $("#review-note").textContent = signedIn
    ? (state.demoStore
        ? "Demo mode: this page saves to this device only - nothing leaves the app."
        : "Saving is real: this page and its photo land in your private account. Only you can see them.")
    : "Preview mode: you can check and edit the reading, but on signed-out devices nothing is saved.";
}

async function showSignedInHome() {
  const signedIn = (state.sbConfigured || state.demoStore) && signedInNow();
  $("#recent").hidden = !signedIn;
  $("#account").hidden = !(state.sbConfigured || state.demoStore);
  setPeopleVisible();
  if (state.demoStore) {
    // no sign-out: this browser IS the account; the erase button covers resets
    $("#account-email").textContent = "Saved on this device · demo";
    $("#btn-signout").hidden = true;
    $("#btn-reset-demo").hidden = false;
  } else {
    $("#account-email").textContent = auth().getSession()?.user?.email || "";
    $("#btn-signout").hidden = false;
    $("#btn-reset-demo").hidden = true;
  }
  setStageNotes();
  // a fresh load straight into the CRM (#people) is honored - a judge or an
  // owner returning to a bookmarked CRM should land on their people, not the
  // marketing screen
  if (story.storySeen() && (location.hash || "") === "#people") {
    await loadPeople();
    return;
  }
  if (story.storySeen()) {
    showView("view-landing");
    coach.step("home"); // first-visit: point at the primary demo button once
  } else {
    // first visit: the five short scenes play before the product appears
    showView("view-landing");
    story.openStory(() => {
      showView("view-landing");
      coach.step("home");
      $("#btn-sample-primary")?.focus({ preventScroll: true });
    });
  }
  if (signedIn) await loadRecent();
}

function showAuth() {
  // Demo mode has no sign-in wall: this browser IS the account (demo-store
  // keeps a constant device owner), so an auth detour would only confuse.
  if (state.demoStore) {
    showSignedInHome();
    return;
  }
  $("#account").hidden = true;
  $("#btn-save").hidden = true;
  setPeopleVisible();
  $("#review-note").textContent = "Sign in to save pages - your account, your data, protected by rules.";
  $("#auth-demo-note").hidden = true;
  $("#auth-note").textContent = "Your data is protected by database rules: no one else can read it, not even other accounts.";
  showView("view-auth");
  window.scrollTo(0, 0);
}

let authMode = "signin";
function setAuthMode(mode) {
  authMode = mode;
  $("#btn-auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
  $("#btn-auth-toggle").textContent = mode === "signin" ? "New here? Create an account" : "Have an account? Sign in";
  $("#auth-password").setAttribute("autocomplete", mode === "signin" ? "current-password" : "new-password");
  $("#auth-error").hidden = true;
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const btn = $("#btn-auth-submit");
  const err = $("#auth-error");
  err.hidden = true;
  btn.disabled = true;
  const saveLabel = btn.textContent;
  btn.textContent = authMode === "signin" ? "Signing in…" : "Creating account…";
  try {
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    if (authMode === "signin") {
      await auth().signIn(email, password);
    } else {
      const r = await auth().signUp(email, password);
      if (r.needsConfirm) {
        btn.disabled = false;
        btn.textContent = "Sign in";
        setAuthMode("signin");
        err.hidden = false;
        err.textContent = "Account created! Check your inbox and confirm your email, then sign in.";
        return;
      }
    }
    await afterAuthSuccess();
  } catch (e2) {
    err.hidden = false;
    err.textContent = e2.message || "Could not sign in. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = saveLabel;
  }
}

async function afterAuthSuccess() {
  await enterSignedIn();
}

async function enterSignedIn() {
  $("#auth-error").hidden = true;
  await showSignedInHome();
}

async function loadRecent() {
  if (!(state.sbConfigured || state.demoStore) || !auth().getSession()) return;
  const list = $("#recent-list");
  // Skeleton while the pages arrive - the strip never "pops" in empty.
  list.innerHTML = [0, 1, 2]
    .map(
      () =>
        `<div class="recent__row recent__skeleton" aria-hidden="true">
          <span class="recent__when sk sk--short"></span>
          <span class="recent__stats sk sk--long"></span>
        </div>`,
    )
    .join("");
  try {
    const pages = await auth().listRecentPages();
    peopleCache.pagesCount = pages.length;
    // always rebuild the people fold - deleting the LAST page must clear the
    // tile/badge too, not leave yesterday's totals on screen
    applyPeopleData(ppl.buildPeople(pages));
    if (!pages.length) {
      list.innerHTML = `<p class="recent__empty">No pages yet - your first photo will appear here.</p>`;
      return;
    }
    list.innerHTML = pages
      .map((p) => {
        const rows = (p.page_rows ?? []).filter((r) => r.included !== false);
        const people = new Set(rows.map((r) => (r.name || "").trim().toLowerCase()).filter(Boolean)).size;
        const due = rows.reduce((s, r) => s + (Number(r.amount_due) || 0), 0);
        const day = (p.taken_on || String(p.created_at).slice(0, 10)) + "";
        return `<div class="recent__row">
          <span class="recent__when">${escapeAttr(day)}</span>
          <span class="recent__stats">${people} ${people === 1 ? "person" : "people"} · ${rows.length} lines · due ₹${fmtMoney(due)}</span>
          <button class="recent__del" data-del-page="${escapeAttr(p.id)}" type="button" title="Remove this page from your ledger" aria-label="Remove this page from your ledger">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 13h8l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
      })
      .join("");
  } catch {
    list.innerHTML = `<p class="recent__empty">Could not load recent pages (offline?).</p>`;
  }
}

/* ------------------------------------------------------------------ people */
const peopleCache = { data: null, byKey: new Map() };

function setPeopleVisible() {
  const on = !!((state.sbConfigured || state.demoStore) && auth().getSession());
  $("#btn-people").hidden = !on;
  $("#tile-people").hidden = !on;
  if (!on) $("#badge-people").hidden = true;
}

// Badge + home tile line are driven by the same fold as the People view.
function applyPeopleData(data) {
  peopleCache.data = data;
  peopleCache.byKey = new Map((data.all ?? []).map((p) => [p.key, p]));
  const badge = $("#badge-people");
  const count = data.totals.toCall ?? 0;
  badge.hidden = !(count > 0);
  if (count > 0) {
    badge.textContent = count; // leave "" when hidden: no stray zero anywhere
  } else {
    badge.textContent = "";
  }
  const sub = $("#tile-people-sub");
  if (data.totals.people === 0) {
    sub.textContent = "Save a page to begin";
  } else if (data.totals.toCall > 0) {
    sub.textContent = `${data.totals.toCall} to call today · ${data.totals.people} people`;
  } else {
    sub.textContent = `${data.totals.people} people · due ₹${ppl.fmtRupees(data.totals.due)} · paid ₹${ppl.fmtRupees(data.totals.paid)}`;
  }
}

/* --------------------------------------------------------- the CRM mode */
// "Demo pages" = pages saved from the made-for-demo samples; "My pages" =
// pages the owner photographed themselves. Cloud pages carry no demo flag
// and always count as the owner's own. Persisted per browser (try/catch).
let crmMode = null;

function resolveCrmMode() {
  if (crmMode) return crmMode;
  const fallback = state.demoStore ? "demo" : "my";
  try {
    crmMode = localStorage.getItem("pl.crm.mode") || fallback;
  } catch {
    crmMode = fallback;
  }
  if (crmMode !== "demo" && crmMode !== "my") crmMode = fallback;
  return crmMode;
}

function reflectCrmMode() {
  $("#mode-demo")?.setAttribute("aria-pressed", String(crmMode === "demo"));
  $("#mode-my")?.setAttribute("aria-pressed", String(crmMode === "my"));
}

async function loadPeople() {
  if (!(state.sbConfigured || state.demoStore) || !auth().getSession()) {
    showAuth();
    return;
  }
  // cloud owners have no demo pages - hide the switch entirely there
  $("#crm-switch").hidden = !state.demoStore;
  const mode = resolveCrmMode();
  reflectCrmMode();
  let pages = [];
  try {
    pages = await auth().listRecentPages();
  } catch {
    $("#people-empty").hidden = false;
    $("#people-empty").querySelector(".card__body").textContent =
      "Could not load your people (offline?). Try again in a moment.";
    return;
  }
  pages = pages.filter((p) => {
    // pages saved before the demo flag existed were all sample reads in the
    // demo store (own-photo reads never saved there), so a missing flag
    // resolves to the store's nature: demo pages on device, own pages in cloud
    const isDemo = p.demo ?? state.demoStore;
    return mode === "demo" ? isDemo : !isDemo;
  });
  const data = ppl.buildPeople(pages);
  applyPeopleData(data);
  peopleCache.pagesCount = pages.length;
  renderPeople(data, pages.length);
  showView("view-people");
  window.scrollTo(0, 0);
}

/* ------------------------------------------------- people-landing nudge */
// One plain-language instruction right after a saved sample lands here:
// what to DO next. Hidden again the moment the visitor acts on it or taps X.
let peopleNudgeDismissed = false;

function showPeopleNudge() {
  if (peopleNudgeDismissed) return;
  const n = $("#people-nudge");
  if (n) n.hidden = false;
}

function hidePeopleNudge() {
  const n = $("#people-nudge");
  if (n) n.hidden = true;
}

/* --------------------------------------------------------- ask (Stage 6) */
const ASK_QS = {
  owe: "Who owes me the most?",
  week: "How was this week in my ledger?",
  today: "Who should I chase today?",
};

// The figures brief the server model is allowed to see - computed HERE from
// the owner's own data, capped small, never customer message text.
function buildAskBrief() {
  const d = peopleCache.data ?? { totals: { due: 0, paid: 0, people: 0, toCall: 0 }, all: [], toCall: [] };
  const t = d.totals;
  const today = ppl.localToday();
  const topDue = [...(d.all ?? [])]
    .filter((p) => p.due > 0)
    .sort((a, b) => b.due - a.due)
    .slice(0, 6)
    .map((p) => ({ name: p.nameMissing ? "(name missing)" : p.name, due: p.due }));
  const todayCall = (d.toCall ?? []).slice(0, 8).map((p) => ({
    name: p.nameMissing ? "(name missing)" : p.name,
    when: p.followUp?.date === today ? "today" : `overdue, was ${p.followUp?.date ?? "unknown"}`,
  }));
  return {
    todayDate: today,
    pages: peopleCache.pagesCount ?? 0,
    totals: { due: t.due, paid: t.paid, people: t.people, toCall: t.toCall },
    topDue,
    todayCall,
  };
}

async function handleAsk(kind) {
  if (state.asking) return; // one calm answer at a time
  state.asking = true;
  const pills = [...document.querySelectorAll(".ask__pill")];
  pills.forEach((p) => (p.disabled = true));
  const el = $("#ask-answer");
  el.hidden = false;
  el.classList.add("ask__a--busy");
  el.textContent = "Working it out from your figures…";
  try {
    const token = auth().getSession()?.access || null;
    const res = await askLedger({ question: ASK_QS[kind] ?? kind, brief: buildAskBrief(), token });
    el.classList.remove("ask__a--busy");
    el.innerHTML = `
      <p class="ask__text">${escapeHTML(res.answer)}</p>
      ${res.basedOn?.length ? `<p class="ask__based">From your figures: ${res.basedOn.map((b) => `<span>${escapeHTML(b)}</span>`).join(" · ")}</p>` : ""}
      ${res.demoMode ? `<p class="ask__demo">Demo answer - the sample data, not your pages (a key switches this live)</p>` : ""}`;
  } catch (e) {
    el.classList.remove("ask__a--busy");
    el.innerHTML = `<p class="ask__text ask__text--err">${escapeHTML(e?.message || "The answer did not come through. Try again in a moment.")}</p>`;
  } finally {
    state.asking = false;
    pills.forEach((p) => (p.disabled = false));
  }
}

function summaryChips(data) {
  const t = data.totals;
  // the stats ARE the filters: tap "To call" to see only today's calls, tap
  // again to release the filter. aria-pressed keeps it honest for keyboards.
  const card = (label, val, cls = "", filter = "") =>
    `<button class="stat${cls ? ` stat--${cls}` : ""}${filter ? " stat--tap" : ""}" type="button"${
      filter ? ` data-filter="${filter}" aria-pressed="${peopleFilter.chip === filter}"` : ""
    }>
      <span class="stat__label">${label}</span>
      <strong class="stat__value">${val}</strong>
    </button>`;
  return [
    card("To call", t.toCall, t.toCall > 0 ? "due" : "", "today"),
    card("Total due", `₹${ppl.fmtRupees(t.due)}`, "", "owes"),
    card("Collected", `₹${ppl.fmtRupees(t.paid)}`, "", "paid"),
  ].join("");
}

function personCard(p, todayList) {
  // one-letter disc: amber when this person is a today-call, quiet otherwise
  const initial = [...(p.nameMissing ? "?" : String(p.name).trim())][0]?.toUpperCase() || "?";
  const ava = `<span class="pcard__ava${p.toCall ? " pcard__ava--due" : ""}" aria-hidden="true">${escapeHTML(initial)}</span>`;

  const money = [
    p.due > 0 ? `<span class="money money--due">due ₹${ppl.fmtRupees(p.due)}</span>` : "",
    p.paid > 0 ? `<span class="money money--in">in ₹${ppl.fmtRupees(p.paid)}</span>` : "",
  ].filter(Boolean).join("") || `<span class="money money--none">no amounts yet</span>`;

  const seen = p.pagesCount ? `${p.pagesCount} ${p.pagesCount === 1 ? "page" : "pages"}${p.lastOn ? ` · last ${niceDay(p.lastOn)}` : ""}` : "";
  const contact = p.waOk ? `+${escapeHTML(p.digits)}` : escapeHTML(String(p.phone ?? "")) || "no phone yet";

  let follow = "";
  if (p.followUp) {
    const f = p.followUp;
    const overdue = f.date < ppl.localToday();
    const when = f.date === ppl.localToday() ? "today" : niceDay(f.date);
    const dueTag = overdue ? ' <span class="fc fc--amber">overdue</span>' : "";
    const doneBtn =
      f.rowId
        ? `<button class="pcard__done" data-page-id="${escapeAttr(f.pageId)}" data-row-id="${escapeAttr(f.rowId)}" type="button" aria-label="Mark follow-up done">Done</button>`
        : "";
    // red = the promise already slipped; amber = due today
    const tone = overdue ? " pcard__follow--over" : p.toCall ? " pcard__follow--due" : "";
    follow = `<div class="pcard__follow${tone}">
        <div class="pcard__follow-text">Follow-up · ${escapeHTML(when)}${f.text ? ` · ${escapeHTML(f.text)}` : ""} ${dueTag}</div>
        ${doneBtn}
      </div>`;
  }

  // history and Call/WhatsApp actions moved into the person side panel
  // (openPersonSheet) - the card stays a calm, tappable summary line.

  return `<article class="pcard${p.toCall ? " pcard--due" : ""}" role="listitem" data-key="${escapeAttr(p.key)}">
    <div class="pcard__line" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Open ${escapeAttr(p.name)} - history, call and message">
      ${ava}
      <div class="pcard__who">
        <h3 class="pcard__name">${p.nameMissing ? `Name missing <span class="chip chip--amber">check the page</span>` : escapeHTML(p.name)}</h3>
        <p class="pcard__meta">${contact}${seen ? ` · ${escapeHTML(seen)}` : ""}</p>
      </div>
      <div class="pcard__money">${money}</div>
    </div>
    ${follow}
  </article>`;
}

/* ------------------------------------------------ people search + filters */
// Chips scope the list; the summary chips above always show the WHOLE truth.
// Sort re-orders the Everyone list only - Call today stays urgency-ordered
// (overdue first) because it is an action queue, not a browse list.
const peopleFilter = { chip: "all", q: "", sort: "due" };

function filterPeople(data) {
  const q = peopleFilter.q.trim().toLowerCase();
  const pass = (p) => {
    if (peopleFilter.chip === "owes" && !(p.due > 0)) return false;
    if (peopleFilter.chip === "today" && !p.toCall) return false;
    if (peopleFilter.chip === "paid" && !(p.paid > 0)) return false;
    if (q) {
      const hay = `${p.name ?? ""} ${p.digits ?? ""} ${p.phone ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const sorters = {
    due: (a, b) => (b.due - a.due) || String(a.name ?? "").localeCompare(String(b.name ?? "")),
    name: (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), ["en", "hi", "ml"]),
    recent: (a, b) => String(b.lastOn ?? "").localeCompare(String(a.lastOn ?? "")),
  };
  const sort = sorters[peopleFilter.sort] ?? sorters.due;
  return {
    toCall: data.toCall.filter(pass),
    rest: data.rest.filter(pass).sort(sort),
    any: data.all.some(pass),
  };
}

function renderPeople(data, pagesCount, fromFilter = false) {
  const hasPeople = data.all.length > 0;
  const emptyEl = $("#people-empty");
  $("#ask-block").hidden = !hasPeople;
  $("#people-tools").hidden = !hasPeople;
  if (!hasPeople) {
    emptyEl.hidden = false;
    emptyEl.querySelector(".card__body").textContent = pagesCount
      ? "The pages you saved did not keep any names or numbers yet. Check them from Recent pages."
      : resolveCrmMode() === "my"
        ? "Pages you photograph yourself land here. The Demo pages side holds the made-for-demo ledger - switch above to see it."
        : "Save a page and its people appear here with money in, money owed and who to call. Nothing is shared - the ledger is yours.";
  } else {
    emptyEl.hidden = true;
  }

  const view = filterPeople(data);
  const hint = $("#people-hint");
  if (hint) hint.hidden = !hasPeople;
  const ov = $("#overdue-banner");
  if (hasPeople && data.totals.overdue > 0) {
    $("#overdue-text").textContent =
      data.totals.overdue === 1
        ? "1 promise was due before today - call first"
        : `${data.totals.overdue} promises were due before today - call first`;
    ov.hidden = false;
  } else {
    ov.hidden = true;
  }
  $("#today-block").hidden = view.toCall.length === 0;
  $("#today-list").innerHTML = view.toCall.map((p) => personCard(p, true)).join("");
  $("#all-block").hidden = view.rest.length === 0;
  $("#people-list").innerHTML = view.rest.map((p) => personCard(p, false)).join("");
  $("#people-none").hidden = view.any || !hasPeople;
  $("#people-summary").innerHTML = hasPeople ? summaryChips(data) : "";
  // chip counts: each filter shows what's behind it before you tap
  if (hasPeople) {
    const counts = {
      all: data.all.length,
      owes: data.all.filter((p) => p.due > 0).length,
      today: data.totals.toCall,
      paid: data.all.filter((p) => p.paid > 0).length,
    };
    [...document.querySelectorAll(".people-chip")].forEach((b) => {
      const base = b.dataset.label ?? (b.dataset.label = b.textContent.trim());
      b.innerHTML = `${escapeHTML(base)} <span class="pill__n">${counts[b.dataset.chip] ?? 0}</span>`;
    });
  }
  if (hasPeople && !fromFilter) animateCounts($("#people-summary"));
  const sk = $("#people-skipped");
  if (data.skipped) {
    sk.hidden = false;
    sk.textContent = `Also on your pages: ${data.skipped.count} line${data.skipped.count === 1 ? "" : "s"} with no name or phone (due ₹${ppl.fmtRupees(data.skipped.due)}). Fix them on the page and they join in.`;
  } else {
    sk.hidden = true;
  }
}

/* --------------------------------------------------- WhatsApp message sheet */
let sheetPerson = null;
let sheetKind = "reminder";

let sheetReturnFocus = null;

function sheetSetText() {
  if (!sheetPerson) return;
  $("#msg-text").value = ppl.fillTemplate(sheetKind, sheetPerson);
}

function openMsgSheet(person, triggerEl = null) {
  if (!person) return;
  coach.complete(); // the visitor is using the real thing - the coach is done
  hidePeopleNudge(); // the nudge did its job
  sheetPerson = person;
  sheetKind = "reminder";
  sheetReturnFocus = triggerEl instanceof HTMLElement ? triggerEl : document.activeElement;
  $(".pill[data-kind='reminder']").classList.add("pill--on");
  // a thanks note makes no sense for someone who never paid - hide it
  const thanksPill = $(".pill[data-kind='thanks']");
  thanksPill.hidden = !person.paid;
  thanksPill.classList.remove("pill--on");
  $("#sheet-name").textContent = person.nameMissing ? "Message this number" : `Message ${person.name}`;
  $("#sheet-sub").textContent = person.waOk ? `to +${person.digits}` : "No usable number on this person";
  const ok = person.waOk;
  $("#btn-wa").disabled = !ok;
  const hint = $("#sheet-hint");
  hint.hidden = ok;
  hint.textContent = "Add a +91 phone number on the page first (review, save, then come back).";
  sheetSetText();
  const panel = $("#sheet-msg .sheet__panel");
  $("#sheet-msg").hidden = false;
  panel.focus({ preventScroll: true });
}

function closeMsgSheet() {
  $("#sheet-msg").hidden = true;
  if (sheetReturnFocus) {
    sheetReturnFocus.focus?.({ preventScroll: true });
    sheetReturnFocus = null;
  }
}

/* ---------------- trust shield: a visible answer to "where does all this go?" */
function shieldStateText() {
  const signedIn = !!auth().getSession();
  if (state.demoStore) return "pages you save live in this browser, on this device only";
  if (state.sbConfigured && signedIn) return "pages go to your own private cloud account";
  return "read-only preview - nothing is being saved yet";
}
function openShield() {
  const sh = $("#sheet-shield");
  if (!sh) return;
  sh.querySelector('[data-slot="state"]').textContent = shieldStateText();
  sh.hidden = false;
  $("#btn-shield").setAttribute("aria-expanded", "true");
  sh.querySelector(".sheet__panel").focus({ preventScroll: true });
}
function closeShield() {
  const sh = $("#sheet-shield");
  if (!sh) return;
  const hadFocus = sh.contains(document.activeElement);
  sh.hidden = true;
  $("#btn-shield").setAttribute("aria-expanded", "false");
  // keyboard users land back on the button that opened the sheet
  if (hadFocus) $("#btn-shield").focus({ preventScroll: true });
}

/* ------------------------------- the More menu (useful, not every-minute) */
function openMore() {
  const sh = $("#sheet-more");
  if (!sh) return;
  // backup/restore are a demo-store feature: a real cloud account's data
  // already lives in the owner's own private project - a browser file would
  // be an incomplete copy pretending to be the whole thing
  const backupBtn = $("#btn-more-backup");
  const restoreBtn = $("#btn-more-restore");
  if (backupBtn) backupBtn.hidden = !state.demoStore;
  if (restoreBtn) restoreBtn.hidden = !state.demoStore;
  sh.hidden = false;
  $("#btn-more").setAttribute("aria-expanded", "true");
  sh.querySelector(".sheet__panel").focus({ preventScroll: true });
}
function closeMore() {
  const sh = $("#sheet-more");
  if (!sh) return;
  const hadFocus = sh.contains(document.activeElement);
  sh.hidden = true;
  $("#btn-more").setAttribute("aria-expanded", "false");
  if (hadFocus) $("#btn-more").focus({ preventScroll: true });
}

/* ------------------ data ownership: CSV export + backup / restore --------- */
// The ledger belongs to the owner, not to this browser. One tap downloads
// every line as a spreadsheet; a backup is a plain JSON file that can be
// restored on any device. Nothing is uploaded anywhere - the file goes
// straight from this device to the owner's hand.
function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per line on a page - kept, struck-out and excluded all travel with
// a status column, so the spreadsheet is the whole truth, not a flattering
// subset. The BOM makes Excel open Malayalam/Hindi notes as UTF-8.
async function downloadLinesCsv() {
  const pages = await auth().listRecentPages();
  const head = ["page_date", "saved_on", "name", "phone", "note", "paid_rupees", "due_rupees", "follow_up_date", "follow_up_done", "status"];
  const rows = [head.join(",")];
  for (const p of pages) {
    for (const r of p.page_rows ?? []) {
      const status = r.struck_out ? "struck-out" : r.included === false ? "excluded" : "kept";
      rows.push([
        p.taken_on ?? "",
        String(p.created_at ?? "").slice(0, 10),
        r.name ?? "",
        r.phone ?? "",
        r.note ?? "",
        r.amount_paid ?? "",
        r.amount_due ?? "",
        r.follow_up_date ?? "",
        r.follow_up_done ? "yes" : "no",
        status,
      ].map(csvCell).join(","));
    }
  }
  downloadFile(
    new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    `page-ledger-lines-${ppl.localToday()}.csv`,
  );
  return pages.reduce((n, p) => n + (p.page_rows?.length ?? 0), 0);
}

// Demo mode only: a real cloud account's data already lives in the owner's
// own private Supabase project, so a browser-file backup would be a lie.
function downloadBackup() {
  const data = demo.exportAllPages();
  downloadFile(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    `page-ledger-backup-${ppl.localToday()}.json`,
  );
  return data.pages.length;
}

/* ------------------------------------------- the person side panel (CRM) */
// One person's whole story: money in / out, the follow-up, every kept line,
// then Call (the phone's own dialer) and WhatsApp (pre-written templates the
// owner edits and sends - rule 6). Bottom sheet on phones, side panel on
// wide screens (CSS).
let panelPerson = null;
let personReturnFocus = null;

function openPersonSheet(key, triggerEl = null) {
  const p = peopleCache.byKey.get(key);
  if (!p) return;
  coach.complete(); // the visitor is using the real thing
  hidePeopleNudge();
  panelPerson = p;
  personReturnFocus = triggerEl instanceof HTMLElement ? triggerEl : document.activeElement;

  $("#person-name").textContent = p.nameMissing ? "Name missing - check the page" : p.name;
  const seen = p.pagesCount ? `${p.pagesCount} ${p.pagesCount === 1 ? "page" : "pages"}${p.lastOn ? ` · last ${niceDay(p.lastOn)}` : ""}` : "";
  $("#person-meta").textContent = [p.waOk ? `+${p.digits}` : String(p.phone ?? "") || "no phone yet", seen]
    .filter(Boolean)
    .join(" · ");

  const moneyBits = [
    p.due > 0 ? `<div class="person-money__item"><span>Due</span><strong class="money money--due">₹${ppl.fmtRupees(p.due)}</strong></div>` : "",
    p.paid > 0 ? `<div class="person-money__item"><span>Collected</span><strong class="money money--in">₹${ppl.fmtRupees(p.paid)}</strong></div>` : "",
  ].filter(Boolean).join("");
  $("#person-money").innerHTML =
    moneyBits || `<div class="person-money__item"><span>Amounts</span><strong class="money money--none">none yet</strong></div>`;

  // the pay row appears only when something is actually owed
  const payRow = $("#person-pay");
  if (payRow) {
    if (p.due > 0) {
      payRow.hidden = false;
      const form = payRow.querySelector(".person-pay__form");
      const openBtn = $("#btn-pay-open");
      if (form) form.hidden = true;
      if (openBtn) openBtn.hidden = false;
      const full = $("#pay-full-amt");
      if (full) full.textContent = ppl.fmtRupees(p.due);
      const amt = $("#person-pay-amt");
      if (amt) amt.value = "";
    } else {
      payRow.hidden = true;
    }
  }

  const f = p.followUp;
  if (f) {
    const overdue = f.date < ppl.localToday();
    const when = f.date === ppl.localToday() ? "today" : niceDay(f.date);
    // same language as the cards: red = the promise slipped, amber = due today
    const tone = overdue ? " pcard__follow--over" : p.toCall ? " pcard__follow--due" : "";
    $("#person-follow").innerHTML = `<div class="pcard__follow${tone}">
      <div class="pcard__follow-text">Follow-up · ${escapeHTML(when)}${f.text ? ` · ${escapeHTML(f.text)}` : ""}${overdue ? ' <span class="fc fc--amber">overdue</span>' : ""}</div>
    </div>`;
  } else {
    $("#person-follow").innerHTML = "";
  }

  // the move row appears only for a real, row-backed follow-up
  const moveRow = $("#person-move");
  if (moveRow) {
    if (f && f.rowId) {
      moveRow.hidden = false;
      moveRow.dataset.pageId = f.pageId;
      moveRow.dataset.rowId = f.rowId;
      const pickRow = moveRow.querySelector(".person-move__pickrow");
      const pickBtn = moveRow.querySelector('[data-move="pick"]');
      if (pickRow) pickRow.hidden = true;
      if (pickBtn) pickBtn.setAttribute("aria-expanded", "false");
    } else {
      moveRow.hidden = true;
    }
  }

  const rows = (p.history ?? [])
    .map((h) => {
      const amt = [
        h.paid ? `<span class="ph__amt money money--in">₹${ppl.fmtRupees(h.paid)} in</span>` : "",
        h.due ? `<span class="ph__amt money money--due">₹${ppl.fmtRupees(h.due)} due</span>` : "",
      ].filter(Boolean).join(" ");
      return `<li class="ph__row"><span class="ph__d">${escapeHTML(niceDay(h.d))}</span><span class="ph__note">${escapeHTML(h.note || "")}</span>${amt}</li>`;
    })
    .join("");
  $("#person-history").innerHTML = rows
    ? `<h3 class="people-sub">Every line kept</h3><ul class="ph">${rows}</ul>`
    : `<p class="person-history__none">No kept lines for this person yet.</p>`;

  // Call is the phone's own dialer (os-level, nothing automated)
  const call = $("#person-call");
  if (p.waOk) {
    call.hidden = false;
    call.href = `tel:+${p.digits}`;
    call.setAttribute("aria-label", `Call ${p.name}`);
  } else {
    call.hidden = true;
  }
  const msg = $("#person-msg");
  msg.disabled = !p.waOk;
  msg.textContent = p.waOk ? "WhatsApp message" : "Phone missing - add it later";

  // one-tap copy of the number, for owners who paste into any other app
  const copyBtn = $("#btn-copy-phone");
  if (copyBtn) {
    copyBtn.hidden = !p.waOk;
    copyBtn.textContent = "Copy number";
  }

  $("#sheet-person").hidden = false;
  $("#sheet-person .sheet__panel").focus({ preventScroll: true });
}

function closePersonSheet() {
  const sh = $("#sheet-person");
  if (!sh) return;
  const hadFocus = sh.contains(document.activeElement);
  sh.hidden = true;
  panelPerson = null;
  if (hadFocus && personReturnFocus) personReturnFocus.focus({ preventScroll: true });
  personReturnFocus = null;
}

async function handleFollowDone(pageId, rowId) {
  try {
    await auth().setFollowUpDone(pageId, rowId, true);
  } catch {
    // the button stays; nothing loses data
  }
  await loadPeople();
}

function localDatePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One honest write: the date changes, it counts as confirmed (the owner set
// it by hand), the panel re-renders on fresh data, and the old date stays
// one Undo tap away.
async function moveFollowUpTo(f, newDate) {
  const key = panelPerson?.key;
  const oldDate = f.date;
  try {
    await auth().setFollowUpDate(f.pageId, f.rowId, newDate);
  } catch {
    window.alert("The follow-up could not be moved. Try again.");
    return;
  }
  await loadPeople();
  if (key && !$("#sheet-person").hidden) openPersonSheet(key, personReturnFocus);
  showUndo(`Follow-up moved to ${niceDay(newDate)}`, async () => {
    try {
      await auth().setFollowUpDate(f.pageId, f.rowId, oldDate);
      await loadPeople();
      if (key && !$("#sheet-person").hidden && panelPerson?.key === key) {
        openPersonSheet(key, personReturnFocus);
      }
    } catch {}
  });
}

const round2 = (x) => Math.round(x * 100) / 100;

// The owner records money received - the loop's true end. Due lines are
// settled oldest first, the way a paper ledger gets crossed out. A full
// settlement also closes the open follow-up: nothing left to chase.
function buildPaymentAllocation(p, amount) {
  const rows = (p.history ?? [])
    .filter((h) => h.due > 0 && h.pageId && h.rowId)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  let left = round2(amount);
  const allocations = [];
  const undo = [];
  for (const h of rows) {
    if (left <= 0) break;
    const take = Math.min(left, h.due);
    allocations.push({
      pageId: h.pageId,
      rowId: h.rowId,
      amountPaid: round2((h.paid || 0) + take),
      amountDue: round2(h.due - take),
    });
    undo.push({ pageId: h.pageId, rowId: h.rowId, amountPaid: round2(h.paid || 0), amountDue: round2(h.due) });
    left = round2(left - take);
  }
  const applied = round2(amount - Math.max(left, 0));
  if (p.followUp?.rowId && applied >= p.due) {
    const f = p.followUp;
    const hit = allocations.find((a) => a.rowId === f.rowId && a.pageId === f.pageId);
    if (hit) hit.followUpDone = true;
    else allocations.push({ pageId: f.pageId, rowId: f.rowId, followUpDone: true });
    undo.push({ pageId: f.pageId, rowId: f.rowId, followUpDone: false });
  }
  return { allocations, undo, applied };
}

// One honest write per row: the amounts change, the panel re-renders on fresh
// data, and the previous numbers stay one Undo tap away.
async function recordPaymentFor(amount) {
  const p = panelPerson;
  if (!p || !(amount > 0)) return;
  const key = p.key;
  const dueBefore = p.due;
  const { allocations, undo, applied } = buildPaymentAllocation(p, amount);
  if (!allocations.length || applied <= 0) return;
  try {
    await auth().recordPayment(allocations);
  } catch {
    window.alert("The payment could not be recorded. Try again.");
    return;
  }
  await loadPeople();
  if (key && !$("#sheet-person").hidden) openPersonSheet(key, personReturnFocus);
  const settled = applied >= dueBefore;
  showUndo(
    settled ? `Settled - ₹${ppl.fmtRupees(applied)} recorded` : `Recorded ₹${ppl.fmtRupees(applied)}`,
    async () => {
      try {
        await auth().recordPayment(undo);
        await loadPeople();
        if (key && !$("#sheet-person").hidden && panelPerson?.key === key) {
          openPersonSheet(key, personReturnFocus);
        }
      } catch {}
    }
  );
}

function onPeopleAction(e) {
  // tap the person line -> the person side panel (history + call + message)
  const lineEl = e.target.closest(".pcard__line");
  if (lineEl) {
    openPersonSheet(lineEl.closest(".pcard")?.dataset.key, lineEl);
    return;
  }
  const done = e.target.closest(".pcard__done");
  if (done) {
    done.disabled = true;
    handleFollowDone(done.dataset.pageId, done.dataset.rowId);
    return;
  }
  const msg = e.target.closest(".msg-btn");
  if (msg && !msg.disabled) openMsgSheet(peopleCache.byKey.get(msg.dataset.key), msg);
}


/* ----------------------------------------------------------------- saving */
// Demo pages keep a small readable thumbnail (device storage is limited).
async function shrinkForDemo(blob) {
  if (!blob) return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("could not shrink"));
      el.src = objectUrl;
    });
    const scale = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.62);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function resetSaveUi() {
  const btn = $("#btn-save");
  const st = $("#save-status");
  st.hidden = true;
  st.classList.remove("save-error");
  st.textContent = "";
  $("#btn-gotop").hidden = true;
  btn.hidden = !((state.sbConfigured || state.demoStore) && auth().getSession() && !state.savedPageId);
  btn.disabled = false;
  btn.classList.remove("is-saved");
  btn.innerHTML = "Confirm and open my CRM";
}

async function handleSave() {
  if (state.saving || !state.extraction) return;
  const user = auth().getSession()?.user;
  if (!user) {
    showAuth();
    return;
  }
  const btn = $("#btn-save");
  const st = $("#save-status");
  state.saving = true;
  btn.disabled = true;
  btn.textContent = "Saving…";
  st.hidden = false;
  st.classList.remove("save-error");
  st.textContent = state.demoStore
    ? "Saving to this device (demo mode)…"
    : "Uploading the photo, then your rows…";

  // a short, honest confirmation buzz on Android; no-op elsewhere
  const celebrateTap = () => {
    try { navigator.vibrate?.(24); } catch {} // haptics are best-effort
  };

  try {
    const pageId = crypto.randomUUID();
    const userId = user.id;
    let photoPath = "no-photo.jpg";
    if (!state.demoStore && state.jpegBlob) {
      const up = await sb.uploadPagePhoto(pageId, state.jpegBlob);
      photoPath = up.path;
    }
    const rowsPayload = state.rows.map((r, i) => ({
      rowIndex: i,
      name: r.fields.name.value ?? "",
      phone: r.fields.phone.value || null,
      note: r.fields.note?.value ?? null,
      amountPaid: r.fields.amountPaid.value,
      amountDue: r.fields.amountDue.value,
      followUpText: r.follow.text,
      followUpDate: r.follow.date,
      followUpConfirmed: r.follow.confirmed,
      struckOut: r.struckOut,
      included: r.included,
      markedOk: !!r.ok, // one-tap row confirmation for this session
      raw: r.raw,
      confidence: {
        name: r.fields.name.conf, phone: r.fields.phone.conf,
        amount_paid: r.fields.amountPaid.conf, amount_due: r.fields.amountDue.conf,
        follow_up_date: r.follow.conf,
      },
      flags: r.flags,
    }));

    if (state.demoStore) {
      // keep a readable thumbnail with the demo page; full photo stays in-session
      const res = await demo.savePage({
        takenOn: state.lastRequest?.baseDate || null,
        pageTotalWritten: state.extraction.page_total_written ?? null,
        pageWarnings: state.extraction.page_warnings ?? [],
        rows: rowsPayload,
        thumb: await shrinkForDemo(state.jpegBlob),
        demo: !!state.lastRequest?.mockFixture, // sample reads feed the Demo pages side of the CRM
      });
      state.savedPageId = res.pageId;
      st.textContent = `Saved on this device (demo) - ${res.savedRows} lines kept.`;
      btn.textContent = "Saved ✓";
      btn.classList.add("is-saved");
      celebrateTap();
      await loadRecent();
      $("#btn-gotop").hidden = false; // the CRM hand-off: who to call, money, both
      // After a SAMPLE save, land straight on People with the plain-language
      // nudge (own-photo saves keep the current view + hand-off button).
      if (state.lastRequest?.mockFixture) {
        setTimeout(() => {
          showPeopleNudge();
          loadPeople().then(() => coach.reach("people"));
        }, 650);
      }
      return;
    }

    const res = await sb.savePage({
      photoPath,
      takenOn: state.lastRequest?.baseDate || null,
      pageTotalWritten: state.extraction.page_total_written ?? null,
      pageWarnings: state.extraction.page_warnings ?? [],
      rows: rowsPayload,
      userId,
    });
    state.savedPageId = res.pageId;
    st.textContent = `Saved - ${res.savedRows} lines and the photo are in your account.`;
    btn.innerHTML = "Saved ✓";
    btn.classList.add("is-saved");
    celebrateTap();
    await loadRecent();
    $("#btn-gotop").hidden = false;
  } catch (e2) {
    st.classList.add("save-error");
    st.textContent = e2.message || "Could not save. Try again.";
    btn.disabled = false;
    btn.innerHTML = "Confirm and open my CRM";
  } finally {
    state.saving = false;
  }
}

/* --------------------------------------------------------------- wires */
function wire() {
  const fileInput = $("#file-input");
  const dropzone = $("#dropzone");

  $("#btn-camera").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) handleSelectedFile(f);
  };

  const stop = (e) => e.preventDefault();
  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      stop(e);
      dropzone.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      stop(e);
      dropzone.classList.remove("dragover");
    }),
  );
  dropzone.addEventListener("drop", (e) => {
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith("image/"));
    if (f) handleSelectedFile(f);
  });
  window.addEventListener("dragover", stop);
  window.addEventListener("drop", stop);

  // Sample pages from bundled fixtures (mock, zero credits). Each card reads
  // its OWN fixture, so the review table matches what the card promises.
  // data-fixture / data-image come from the card markup; the "made for this
  // demo" pages live in fixtures/made/, the credited 1860s scan in
  // fixtures/demo-pages/.
  const readSamplePage = async (fixture, image) => {
    if (state.busy) return;
    try {
      const res = await fetch(image);
      if (!res.ok) throw new Error("The sample page photo could not be loaded.");
      const blob = await res.blob();
      await handleSelectedFile(blob, { mockFixture: fixture });
    } catch (e) {
      $("#error-msg").textContent = e.message || "The sample page could not be loaded.";
      $("#error-detail").hidden = true;
      showView("view-error");
    }
  };
  [...document.querySelectorAll(".sample-card")].forEach((card) => {
    // When a real recording of this sample exists (scripts/record-fixtures.js),
    // extend the honest label instead of replacing it.
    const rec = RECORDED[card.dataset.fixture];
    if (rec) {
      const tag = card.querySelector(".sample-card__tag");
      if (tag) tag.textContent = `Real reading recorded ${niceDay(rec.date)} with ${rec.model || "Muse Spark Open"} · replayed free`;
    }
    card.onclick = () => readSamplePage(card.dataset.fixture, card.dataset.image);
  });
  // the big primary button opens the demo picker (the 5 sample pages)
  $("#btn-sample-primary").onclick = () => showView("view-picker");
  $("#btn-own-page").onclick = () => {
    showView("view-upload");
    $("#btn-camera")?.focus({ preventScroll: true });
  };
  $("#btn-picker-own").onclick = () => {
    showView("view-upload");
    $("#btn-camera")?.focus({ preventScroll: true });
  };
  $("#btn-upload-to-picker").onclick = () => showView("view-picker");
  // the brand mark is the calm way back to the landing
  $("#brand").onclick = (e) => {
    e.preventDefault();
    showView("view-landing");
    window.scrollTo(0, 0);
  };

  $("#btn-retry").onclick = () => {
    if (state.lastRequest) runExtraction(state.lastRequest);
    else showSignedInHome();
  };
  $("#btn-error-back").onclick = resetToUpload;
  $("#btn-back").onclick = () => {
    resetToUpload();
    showView("view-picker"); // the demo loop: read -> check -> back -> next sample
  };

  $("#btn-add-row").onclick = () => {
    const r = makeRow({ flags: ["added by hand"] });
    state.rows.push(r);
    renderRows();
    updateTotals();
    $(`#rows .rowcard[data-id="${r.id}"] input[data-key="name"]`)?.focus();
  };

  const rowsEl = $("#rows");

  rowsEl.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.matches("input[data-act='edit']")) return;
    const row = state.rows.find((r) => r.id === t.dataset.id);
    if (!row) return;
    const key = t.dataset.key;
    if (key === "follow") {
      row.follow.date = t.value || null;
      row.follow.edited = true;
      row.follow.confirmed = false; // must re-confirm after edits
      refreshRow(t.dataset.id, "follow");
      return;
    }
    if (key === "followText") {
      row.follow.text = t.value;
      row.follow.edited = true;
      if (micStatus.rowId === row.id && micStatus.mode === "desc") {
        micStatus.rowId = null; // owner touched the filled note - quiet down
        micStatus.mode = null;
      }
      refreshRow(t.dataset.id, null);
      return;
    }
    const f = row.fields[key];
    if (!f) return;
    if (key === "amountPaid" || key === "amountDue") {
      const n = t.value === "" ? null : Number(t.value);
      f.value = n != null && Number.isNaN(n) ? null : n;
    } else {
      f.value = t.value;
    }
    f.edited = true;
    refreshRow(t.dataset.id, key);
  });

  // undo snapshots for plain edits: taken at FIRST focus of an edit session
  // (a Map keyed by row+field - refreshRow replaces the focused node, firing
  // focusout→focusin, and the snapshot must survive that), offered on blur.
  const editSnaps = new Map();
  const snapKey = (id, key) => `${id}:${key}`;
  rowsEl.addEventListener("focusin", (e) => {
    const t = e.target;
    if (!t.matches("input[data-act='edit'], input[data-act]")) return;
    const row = state.rows.find((r) => r.id === t.dataset?.id);
    if (!row) return;
    const k = snapKey(t.dataset.id, t.dataset.key);
    if (editSnaps.has(k)) return; // the edit session already has its "before"
    const isFollow = t.dataset.key === "follow";
    const prev = isFollow ? row.follow.date : (row.fields[t.dataset.key]?.value ?? "");
    editSnaps.set(k, { id: t.dataset.id, key: t.dataset.key, prev: String(prev ?? ""), kind: isFollow ? "follow" : "field" });
  });
  rowsEl.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!t.matches?.("input[data-act='edit'], input[data-act]")) return;
    const k = snapKey(t.dataset?.id ?? "", t.dataset?.key ?? "");
    const snap = editSnaps.get(k);
    editSnaps.delete(k);
    if (!snap) return;
    const row = state.rows.find((r) => r.id === snap.id);
    if (!row) return;
    const now = snap.kind === "follow" ? String(row.follow.date ?? "") : String(row.fields[snap.key]?.value ?? "");
    if (now === snap.prev) return;
    const label = FIELD_UNDO_LABELS[snap.key] ?? "edit";
    showUndo(`Changed ${label} (${snap.prev} → ${now})`, () => {
      if (snap.kind === "follow") row.follow.date = snap.prev || null;
      else if (row.fields[snap.key]) {
        row.fields[snap.key].value = snap.key === "amountPaid" || snap.key === "amountDue"
          ? (snap.prev === "" ? null : Number(snap.prev))
          : snap.prev;
      }
      refreshRow(snap.id, null);
    });
  });

  // Enter = confirm the row; ↓ / ↑ walk the same field across rows
  rowsEl.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t.matches?.("input[data-act='edit']")) return;
    const row = state.rows.find((r) => r.id === t.dataset?.id);
    if (e.key === "Enter") {
      e.preventDefault();
      if (!row) return;
      editSnaps.delete(snapKey(row.id, t.dataset.key)); // commit: no edit-undo dwarfs the confirm toast
      if (!row.ok) {
        row.ok = true; // the owner says: this line is right
        refreshRow(row.id, null);
        showUndo(`Marked "${row.fields.name.value || "row"}" as checked`, () => {
          row.ok = false;
          refreshRow(row.id, null);
        });
        t.blur();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const idx = state.rows.findIndex((r) => r.id === row?.id);
      const next = state.rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      const el = $(`#rows .rowcard[data-id="${next.id}"] input[data-key="${t.dataset.key}"]`);
      el?.focus();
    }
  });

  rowsEl.addEventListener("change", (e) => {
    const t = e.target;
    const row = state.rows.find((r) => r.id === t.dataset?.id);
    if (!row) return;
    if (t.matches("input[data-act='include']")) {
      row.included = t.checked;
      refreshRow(row.id);
    } else if (t.matches("input[data-act='confirm-follow']")) {
      row.follow.confirmed = t.checked;
      refreshRow(row.id);
      $(`#rows .rowcard[data-id="${row.id}"] input[data-key="follow"]`)?.blur();
    }
  });

  rowsEl.addEventListener("click", (e) => {
    const micBtn = e.target.closest("button[data-act='mic']");
    if (micBtn) {
      handleMic(micBtn.dataset.id);
      return;
    }
    const rawBtn = e.target.closest("button[data-act='raw']");
    if (rawBtn) {
      const line = document.querySelector(`.rawline[data-rawid="${rawBtn.dataset.id}"]`);
      if (line) {
        line.hidden = !line.hidden;
        rawBtn.setAttribute("aria-expanded", String(!line.hidden));
        rawBtn.textContent = line.hidden ? "see line" : "hide line";
      }
      return;
    }
    // one-tap owner confirmation of one row (undoable)
    const okBtn = e.target.closest("button[data-act='rowok']");
    if (okBtn) {
      const row = state.rows.find((r) => r.id === okBtn.dataset.id);
      if (!row) return;
      row.ok = !row.ok;
      refreshRow(row.id, null);
      showUndo(row.ok ? `Marked row as checked` : `Row back to unchecked`, () => {
        row.ok = !row.ok;
        refreshRow(row.id, null);
      });
      return;
    }
    // tapping the row (not on a control/input) -> show that line on the photo
    const card = e.target.closest(".rowcard[data-id]");
    const onControl = e.target.closest("button, input, label, .rawline");
    if (card && !onControl) {
      rowOnPhotoHighlight(card.dataset.id);
      return;
    }
    const t = e.target.closest("button[data-act='del']");
    if (!t) return;
    const row = state.rows.find((r) => r.id === t.dataset.id);
    if (!row) return;
    const label = row.fields.name.value || "this row";
    if (confirm(`Remove ${label}? (The notebook page stays untouched.)`)) {
      const idx = state.rows.indexOf(row);
      state.rows.splice(idx, 1);
      renderRows();
      updateTotals();
      showUndo(`Removed ${label}`, () => {
        state.rows.splice(Math.min(idx, state.rows.length), 0, row);
        renderRows();
        updateTotals();
      });
    }
  });

  // one tap marks every clean line checked (undo restores the previous marks)
  $("#btn-confirm-clear").onclick = () => {
    const before = new Map(state.rows.map((r) => [r.id, r.ok]));
    let changed = 0;
    for (const r of state.rows) {
      const clean = !r.struckOut && r.included && (r.flags ?? []).length === 0;
      if (clean && !r.ok) { r.ok = true; changed++; }
    }
    if (!changed) return;
    renderRows();
    updateTotals();
    showUndo(`Marked ${changed} line${changed === 1 ? "" : "s"} checked`, () => {
      for (const r of state.rows) r.ok = before.get(r.id) ?? false;
      renderRows();
      updateTotals();
    });
  };

  // photo tap -> scroll to the nearest row (only when row boxes exist; the
  // zoom tag keeps its own open-zoom job)
  $("#photo-box").addEventListener("click", (e) => {
    if (e.target.closest("#btn-zoom")) return;
    if ($("#photo-bbox")?.hidden) return;
    const row = photoRowAt(e.clientX, e.clientY);
    if (!row) return;
    highlightRowOnPhoto(row.id);
    const card = $(`#rows .rowcard[data-id="${row.id}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("row-flash");
    setTimeout(() => card.classList.remove("row-flash"), 1200);
  });

  // zoom overlay
  $("#btn-zoom").onclick = () => {
    $("#zoom-img").src = state.thumbSrc ?? $("#thumb-img").src;
    $("#zoom-overlay").hidden = false;
  };
  const closeZoom = () => {
    $("#zoom-overlay").hidden = true;
  };
  $("#btn-zoom-close").onclick = closeZoom;
  $("#zoom-overlay").addEventListener("click", (e) => {
    if (e.target.closest("#zoom-img") == null) closeZoom();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeZoom();
  });
  // row positions on the photo depend on the displayed crop -> recompute
  window.addEventListener("resize", () => syncBboxOverlay());

  // --- Stage 2: auth + saving
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#btn-auth-toggle").onclick = () => setAuthMode(authMode === "signin" ? "signup" : "signin");
  $("#btn-signout").onclick = async () => {
    await auth().signOut();
    resetToUpload();
    setAuthMode("signin");
    $("#auth-email").value = "";
    $("#auth-password").value = "";
    showAuth();
  };
  $("#btn-save").onclick = handleSave;

  /* ---------------- Stage 3: People view + WhatsApp message sheet ---------------- */
  $("#btn-people").onclick = () => loadPeople();
  $("#tile-people").onclick = () => loadPeople();

  $("#people-nudge-x").onclick = () => {
    peopleNudgeDismissed = true;
    hidePeopleNudge();
  };
  $("#btn-people-back").onclick = () => showView("view-picker"); // the demo loop continues

  /* ------------- CRM: Demo pages / My pages switch ----------------------- */
  const setMode = (mode) => {
    if (crmMode === mode) return;
    crmMode = mode;
    try {
      localStorage.setItem("pl.crm.mode", mode);
    } catch {}
    reflectCrmMode();
    loadPeople();
  };
  $("#mode-demo").onclick = () => setMode("demo");
  $("#mode-my").onclick = () => setMode("my");

  /* ------------- person side panel --------------------------------------- */
  $("#btn-person-close").onclick = closePersonSheet;
  $("#person-backdrop").onclick = closePersonSheet;
  $("#person-msg").onclick = (e) => {
    if (panelPerson) openMsgSheet(panelPerson, e.currentTarget);
  };
  // keyboard: Enter/Space on a person card opens the panel
  const personKey = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const line = e.target.closest?.(".pcard__line");
    if (line) {
      e.preventDefault();
      openPersonSheet(line.closest(".pcard")?.dataset.key, line);
    }
  };
  $("#today-list").addEventListener("keydown", personKey);
  $("#people-list").addEventListener("keydown", personKey);

  /* ------------- Section 3: people search + filter chips + history ------- */
  $("#people-search").addEventListener("input", (e) => {
    peopleFilter.q = e.target.value;
    renderPeople(peopleCache.data, peopleCache.pagesCount ?? 0, true);
  });
  [...document.querySelectorAll(".people-chip")].forEach((chipBtn) => {
    chipBtn.onclick = () => {
      peopleFilter.chip = chipBtn.dataset.chip;
      [...document.querySelectorAll(".people-chip")].forEach((x) =>
        x.setAttribute("aria-pressed", String(x === chipBtn)),
      );
      renderPeople(peopleCache.data, peopleCache.pagesCount ?? 0, true);
    };
  });
  // the stat cards ARE filters: tap to apply, tap again to release
  $("#people-summary").addEventListener("click", (e) => {
    const b = e.target.closest(".stat--tap");
    if (!b) return;
    const active = b.getAttribute("aria-pressed") === "true";
    const target = active ? "all" : b.dataset.filter;
    document.querySelector(`.people-chip[data-chip="${target}"]`)?.click();
  });

  /* ------------- Section 3: ask with your own words ---------------------- */
  $("#ask-typed").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#ask-typed-q").value.trim();
    if (!q) return;
    handleAsk(q); // free-form question, same grounded brief + demo labels
    $("#ask-typed-q").value = "";
  });

  $("#today-list").addEventListener("click", onPeopleAction);
  $("#people-list").addEventListener("click", onPeopleAction);
  $("#btn-sheet-close").onclick = closeMsgSheet;
  $("#sheet-backdrop").onclick = closeMsgSheet;
  // browser Back/Forward walks the saved views instead of leaving the app
  window.addEventListener("popstate", () => {
    const name = (location.hash || "").replace(/^#/, "");
    const view = ["landing", "upload", "picker", "review", "people"].includes(name)
      ? `view-${name}`
      : "view-landing";
    if (!$(`#${view}`).hidden) return; // already there
    if (view === "view-review" && !state.extraction) return; // nothing to show
    // a deep link (or Back) into the CRM needs its data - an empty shell
    // would look like data loss
    if (view === "view-people" && !peopleCache.data) {
      loadPeople();
      return;
    }
    historySync = true;
    showView(view);
  });
  document.addEventListener("keydown", (e) => {
    // whichever sheet is open (msg, shield, more, person) answers Escape first
    const openSheet = [...document.querySelectorAll(".sheet")].find((s) => !s.hidden);
    if (e.key === "Escape" && openSheet) {
      ({ "sheet-msg": closeMsgSheet, "sheet-shield": closeShield, "sheet-more": closeMore, "sheet-person": closePersonSheet }[openSheet.id] ?? (() => {}))();
    }
    // keep Tab inside whichever sheet is open (keyboard focus trap)
    if (e.key === "Tab") {
      const sh = openSheet;
      if (!sh) return;
      const els = [
        ...sh.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (!sh.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  // the trust shield: always available, never an interrupt
  $("#btn-shield").onclick = openShield;
  $("#btn-shield-close").onclick = closeShield;
  $("#shield-backdrop").onclick = closeShield;
  // the More menu: privacy, erase demo, sign out, how it was built
  $("#btn-more").onclick = openMore;
  $("#btn-more-close").onclick = closeMore;
  $("#more-backdrop").onclick = closeMore;
  $("#btn-more-privacy").onclick = () => {
    closeMore();
    openShield();
  };
  // data ownership: spreadsheet of every line, JSON backup, restore (demo only)
  $("#btn-more-csv").onclick = async () => {
    try {
      const n = await downloadLinesCsv();
      closeMore();
      showUndo(`Spreadsheet downloaded - ${n} line${n === 1 ? "" : "s"}`, () => {});
    } catch {
      window.alert("The spreadsheet could not be built. Try again.");
    }
  };
  $("#btn-more-backup").onclick = () => {
    try {
      const n = downloadBackup();
      closeMore();
      showUndo(`Backup downloaded - ${n} page${n === 1 ? "" : "s"}`, () => {});
    } catch {
      window.alert("The backup could not be built. Try again.");
    }
  };
  $("#btn-more-restore").onclick = () => $("#file-restore").click();
  $("#file-restore").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file twice must still work
    if (!file) return;
    let data = null;
    try {
      data = JSON.parse(await file.text());
    } catch {}
    if (!data || data.app !== "page-ledger" || !Array.isArray(data.pages)) {
      window.alert("That file is not a Page Ledger backup.");
      return;
    }
    const n = data.pages.length;
    const ok = window.confirm(`Restore ${n} page${n === 1 ? "" : "s"} from this backup? Nothing you have now is deleted.`);
    if (!ok) return;
    try {
      const res = demo.restoreAllPages(data);
      await loadPeople();
      await loadRecent();
      closeMore();
      showUndo(`Backup restored - ${res.added} page${res.added === 1 ? "" : "s"} added`, () => {});
    } catch (err) {
      window.alert(err?.message || "The backup could not be restored.");
    }
  });
  // the 5-scene intro, replayable on demand (a demo aid that costs nothing)
  $("#btn-more-story").onclick = () => {
    closeMore();
    story.openStory(() => {
      showView("view-landing");
      $("#btn-sample-primary")?.focus({ preventScroll: true });
    });
  };
  // sort pills: re-order the Everyone list (Call today stays urgency-ordered)
  [...document.querySelectorAll(".people-sort")].forEach((sortBtn) => {
    sortBtn.onclick = () => {
      peopleFilter.sort = sortBtn.dataset.sort;
      [...document.querySelectorAll(".people-sort")].forEach((x) =>
        x.setAttribute("aria-pressed", String(x === sortBtn)),
      );
      renderPeople(peopleCache.data, peopleCache.pagesCount ?? 0, true);
    };
  });
  // copy the number: for owners who paste it into any other app themselves
  $("#btn-copy-phone").onclick = async () => {
    if (!panelPerson?.waOk) return;
    try {
      await navigator.clipboard.writeText(`+${panelPerson.digits}`);
      const b = $("#btn-copy-phone");
      b.textContent = "Copied";
      setTimeout(() => {
        b.textContent = "Copy number";
      }, 1600);
    } catch {
      // clipboard blocked (older browser): the number sits right above, readable
    }
  };
  // move a follow-up: the loop closes after the call ("he'll come Friday")
  $("#person-move").addEventListener("click", async (e) => {
    const row = $("#person-move");
    const btn = e.target.closest(".person-move__btn");
    if (btn && btn.dataset.move === "pick") {
      const pickRow = row.querySelector(".person-move__pickrow");
      pickRow.hidden = !pickRow.hidden;
      btn.setAttribute("aria-expanded", String(!pickRow.hidden));
      if (!pickRow.hidden) $("#person-move-date").focus({ preventScroll: true });
      return;
    }
    if (btn && btn.dataset.move !== "pick" && btn.dataset.move !== "go") {
      const f = panelPerson?.followUp;
      if (!f?.rowId) return;
      const newDate = btn.dataset.move === "today" ? ppl.localToday() : localDatePlus(1);
      await moveFollowUpTo(f, newDate);
      return;
    }
  });
  $("#person-move .person-move__go").addEventListener("click", async () => {
    const f = panelPerson?.followUp;
    const v = $("#person-move-date").value;
    if (!f?.rowId || !v) return;
    await moveFollowUpTo(f, v);
  });

  // record payment: money received, in the owner's own hand
  $("#btn-pay-open").addEventListener("click", () => {
    $("#person-pay .person-pay__form").hidden = false;
    $("#btn-pay-open").hidden = true;
    $("#person-pay-amt").focus({ preventScroll: true });
  });
  $("#btn-pay-full").addEventListener("click", () => {
    const p = panelPerson;
    if (!p) return;
    $("#person-pay-amt").value = p.due;
    $("#btn-pay-save").focus({ preventScroll: true });
  });
  $("#person-pay-amt").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#btn-pay-save").click();
    }
  });
  $("#btn-pay-save").addEventListener("click", async () => {
    const p = panelPerson;
    if (!p) return;
    const v = round2(parseFloat($("#person-pay-amt").value));
    if (!(v > 0)) {
      $("#person-pay-amt").focus();
      return;
    }
    await recordPaymentFor(Math.min(v, p.due));
  });

  // the appbar gains depth once content scrolls beneath it
  const bar = document.querySelector(".appbar");
  if (bar) {
    const onScroll = () => bar.classList.toggle("appbar--scrolled", (window.scrollY || 0) > 6);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  // overdue banner: one tap switches to the Call today list
  $("#overdue-banner").onclick = () =>
    document.querySelector('.people-chip[data-chip="today"]')?.click();
  [...document.querySelectorAll(".sheet__pills .pill")].forEach((pill) => {
    pill.onclick = () => {
      [...document.querySelectorAll(".sheet__pills .pill")].forEach((x) => x.classList.remove("pill--on"));
      pill.classList.add("pill--on");
      sheetKind = pill.dataset.kind;
      sheetSetText();
    };
  });
  $("#btn-wa").onclick = () => {
    if (!sheetPerson?.waOk) return;
    const text = encodeURIComponent($("#msg-text").value);
    // New tab keeps the ledger open exactly where the owner left it - the
    // sheet only hands the words over, WhatsApp does the sending.
    window.open(`https://wa.me/${sheetPerson.digits}?text=${text}`, "_blank", "noopener");
    closeMsgSheet();
  };

  $("#btn-gotop").onclick = () => loadPeople();

  /* ---------------- Stage 5: honesty panel + page removal + demo reset ---------------- */
  $("#recent-list").addEventListener("click", async (e) => {
    const del = e.target.closest("button[data-del-page]");
    if (!del) return;
    if (
      !confirm(
        "Remove this page from your ledger? The notebook itself is untouched, and this cannot be undone.",
      )
    ) {
      return;
    }
    del.disabled = true;
    try {
      await auth().deletePage(del.dataset.delPage);
      await loadRecent();
    } catch {
      del.disabled = false;
    }
  });

  $("#btn-reset-demo").onclick = () => {
    if (
      !confirm(
        "Erase every demo page from this browser? Nothing on any real project is touched, and this cannot be undone.",
      )
    ) {
      return;
    }
    demo.resetDemoData();
    location.reload();
  };

  /* ---------------- Stage 6: ask about your own figures ---------------- */
  [...document.querySelectorAll(".ask__pill")].forEach((pill) => {
    pill.onclick = () => handleAsk(pill.dataset.q);
  });
}

wire();
coach.init();
story.initStory();
setAuthMode("signin");

(async function boot() {
  let cfg = null;
  try {
    cfg = await getConfig();
  } catch {}
  state.sbConfigured = !!cfg?.configured;
  if (!state.sbConfigured) {
    // No project keys yet: demo mode. There is no sign-in wall - the device
    // owner session is constant (demo-store keeps it), so the app opens ready.
    state.demoStore = true;
    await demo.restoreSession().catch(() => null);
    await showSignedInHome();
    return;
  }
  const session = await sb.restoreSession().catch(() => null);
  if (session) await showSignedInHome();
  else showAuth();
})();

/* hero 3D tilt - pointer-driven, desktop pointers with reduced-motion respected */
(() => {
  const scene = $("#hero-scene");
  if (!scene) return;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!fine.matches || calm.matches) return;
  scene.addEventListener("pointermove", (e) => {
    const r = scene.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    scene.style.transform = `perspective(900px) rotateY(${(x * 9).toFixed(2)}deg) rotateX(${(-y * 7).toFixed(2)}deg)`;
  });
  scene.addEventListener("pointerleave", () => {
    scene.style.transform = "";
  });
})();
