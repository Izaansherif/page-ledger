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
import { RECORDED } from "./recorded-fixtures.js";
import { CAPTIONS, STORY_BOXES } from "./story-notes.js";
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

function showView(name) {
  for (const v of ["view-upload", "view-loading", "view-error", "view-review", "view-auth", "view-people"]) {
    $(`#${v}`).hidden = v !== name;
  }
  syncBottomBar(name);
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
    "view-upload": { p: ["Try a sample page", () => $("#btn-sample-primary").click()], s: ["Photograph", () => $("#btn-camera").click()] },
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
  $("#review-summary").textContent = `${names.size} ${names.size === 1 ? "person" : "people"} · ${n} ${n === 1 ? "line" : "lines"} · due ₹${fmtMoney(b.due)} — check line by line with the photo, then Save this page`;
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
      `<li>Written total on the page: <strong>&#8377;${fmtMoney(total)}</strong> - make sure the rows add up to about this (full check arrives in Stage&nbsp;5).</li>`,
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
    const res = await extractPage(request, auth().getSession()?.access || null);
    const elapsed = performance.now() - t0;
    const wait = Math.max(0, 1200 - elapsed); // a deliberate beat, so the demo doesn't look fake-fast
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
  $("#home-note").innerHTML = signedIn
    ? (state.demoStore
        ? "Demo mode: your pages save to <strong>this device only</strong> - connect the project later for cloud backup."
        : "Signed in. Pages you save stay in your private account.")
    : "Stage&nbsp;1 preview: pages are read and checked, nothing is saved yet.";
  $("#review-note").textContent = signedIn
    ? (state.demoStore
        ? "Demo mode: this page saves to this device only - nothing leaves the app."
        : "Saving is real: this page + photo land in your account, protected by database rules.")
    : "Stage\u00A01 preview: nothing is saved yet - saving arrives with your project keys.";
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
  showView("view-upload");
  if (signedIn) await loadRecent();
  coach.step("home"); // first-visit: point at the primary sample button once
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

async function loadPeople() {
  if (!(state.sbConfigured || state.demoStore) || !auth().getSession()) {
    showAuth();
    return;
  }
  let pages = [];
  try {
    pages = await auth().listRecentPages();
  } catch {
    $("#people-empty").hidden = false;
    $("#people-empty").querySelector(".card__body").textContent =
      "Could not load your people (offline?). Try again in a moment.";
    return;
  }
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
  const chip = (label, val, cls = "") => `<span class="chip--info ${cls}">${label} <strong>${val}</strong></span>`;
  return [
    chip("To call", t.toCall, t.toCall > 0 ? "chip--since" : ""),
    chip("People", t.people),
    chip("Due", `₹${ppl.fmtRupees(t.due)}`),
    chip("Paid in", `₹${ppl.fmtRupees(t.paid)}`),
  ].join("");
}

function personCard(p, todayList) {
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
    follow = `<div class="pcard__follow${p.toCall ? " pcard__follow--due" : ""}">
        <div class="pcard__follow-text">Follow-up · ${escapeHTML(when)}${f.text ? ` · ${escapeHTML(f.text)}` : ""} ${dueTag}</div>
        ${doneBtn}
      </div>`;
  }

  // expandable history (Section 3): every kept line with money, newest first
  const historyRows = (p.history ?? [])
    .map((h) => {
      const amt = h.paid
        ? `<span class="ph__amt money money--in">₹${ppl.fmtRupees(h.paid)} in</span>`
        : h.due
          ? `<span class="ph__amt money money--due">₹${ppl.fmtRupees(h.due)} due</span>`
          : "";
      return `<li class="ph__row"><span class="ph__d">${escapeHTML(niceDay(h.d))}</span><span class="ph__note">${escapeHTML(h.note || "")}</span>${amt}</li>`;
    })
    .join("");
  const history = historyRows
    ? `<div class="pcard__history" hidden><ul class="ph">${historyRows}</ul></div>`
    : "";

  // Call is the phone's own dialer (os-level, nothing automated); the message
  // sheet stays pre-written templates the owner sends themselves (rule 6).
  const callBtn = p.waOk
    ? `<a class="btn btn--ghost btn--small call-btn" href="tel:+${escapeAttr(p.digits)}" aria-label="Call ${escapeAttr(p.name)}">Call</a>`
    : "";

  return `<article class="pcard${p.toCall ? " pcard--due" : ""}${historyRows ? " pcard--fold" : ""}" role="listitem" data-key="${escapeAttr(p.key)}">
    <div class="pcard__line"${historyRows ? ' title="Tap this person to see their history"' : ""}>
      <div class="pcard__who">
        <h3 class="pcard__name">${p.nameMissing ? `Name missing <span class="chip chip--amber">check the page</span>` : escapeHTML(p.name)}</h3>
        <p class="pcard__meta">${contact}${seen ? ` · ${escapeHTML(seen)}` : ""}</p>
      </div>
      <div class="pcard__money">${money}</div>
    </div>
    ${follow}
    ${history}
    <div class="pcard__actions">
      ${callBtn}
      <button class="btn btn--primary btn--small msg-btn" data-key="${escapeAttr(p.key)}" type="button" ${p.waOk ? "" : "disabled"}>
        ${p.waOk ? "WhatsApp message" : "Phone missing - add it later"}
      </button>
    </div>
  </article>`;
}

/* ------------------------------------------------ people search + filters */
// Chips scope the list; the summary chips above always show the WHOLE truth.
const peopleFilter = { chip: "all", q: "" };

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
  return {
    toCall: data.toCall.filter(pass),
    rest: data.rest.filter(pass),
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
      : "Save a page and its people appear here with money in, money owed and who to call. Nothing is shared - the ledger is yours.";
  } else {
    emptyEl.hidden = true;
  }

  const view = filterPeople(data);
  $("#today-block").hidden = view.toCall.length === 0;
  $("#today-list").innerHTML = view.toCall.map((p) => personCard(p, true)).join("");
  $("#all-block").hidden = view.rest.length === 0;
  $("#people-list").innerHTML = view.rest.map((p) => personCard(p, false)).join("");
  $("#people-none").hidden = view.any || !hasPeople;
  $("#people-summary").innerHTML = hasPeople ? summaryChips(data) : "";
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

async function handleFollowDone(pageId, rowId) {
  try {
    await auth().setFollowUpDone(pageId, rowId, true);
  } catch {
    // the button stays; nothing loses data
  }
  await loadPeople();
}

function onPeopleAction(e) {
  // tap the person line -> fold open their history (Section 3)
  const lineEl = e.target.closest(".pcard__line");
  if (lineEl) {
    const card = lineEl.closest(".pcard");
    const hist = card?.querySelector(".pcard__history");
    if (hist) {
      const open = card.classList.toggle("pcard--open");
      hist.hidden = !open;
      lineEl.setAttribute("aria-expanded", String(open));
    }
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
  btn.innerHTML = "Save this page";
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
      });
      state.savedPageId = res.pageId;
      st.textContent = `Saved on this device (demo) - ${res.savedRows} lines kept.`;
      btn.textContent = "Saved ✓";
      btn.classList.add("is-saved");
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
    await loadRecent();
    $("#btn-gotop").hidden = false;
  } catch (e2) {
    st.classList.add("save-error");
    st.textContent = e2.message || "Could not save. Try again.";
    btn.disabled = false;
    btn.innerHTML = "Save this page";
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
      if (tag) tag.textContent = `Real reading recorded ${niceDay(rec.date)} · replayed free`;
    }
    card.onclick = () => readSamplePage(card.dataset.fixture, card.dataset.image);
  });
  // the big primary button starts the DEFAULT sample without a second tap
  $("#btn-sample-primary").onclick = () =>
    readSamplePage("made/dental", "/fixtures/made/dental.jpg");

  $("#btn-retry").onclick = () => {
    if (state.lastRequest) runExtraction(state.lastRequest);
    else showSignedInHome();
  };
  $("#btn-error-back").onclick = resetToUpload;
  $("#btn-back").onclick = resetToUpload;

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
  $("#btn-people-back").onclick = () => showView("view-upload");

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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet-msg").hidden) closeMsgSheet();
  });
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

/* ------------------------------------------- real build story (git only) */
// The home story block is generated from js/timeline.json - scripts/
// make-timeline.js reads the actual git log and groups commits by day.
// Captions, when they exist, come from js/story-notes.js: words written by
// the owner. This code never writes a story of its own - if the fetch fails
// the section stays closed and honest.
async function renderStoryTimeline() {
  const el = $("#built-timeline");
  const noteEl = $("#built-note");
  if (!el) return;
  let t;
  try {
    const res = await fetch("js/timeline.json", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    t = await res.json();
    if (!Array.isArray(t.days) || t.days.length === 0) throw new Error("empty");
  } catch {
    noteEl.hidden = false;
    noteEl.textContent =
      "The commit timeline is not available right now (offline?). It lives at js/timeline.json in the repo.";
    return;
  }

  // one block per day: the day, the owner's caption (only if written), then
  // the raw commit subjects - the record judges can check in the repo
  el.innerHTML = t.days
    .map(({ date, commits }) => {
      const caption = CAPTIONS[date];
      return `<li>
        <span class="built__day">${escapeHTML(niceDay(date))}</span>
        <div class="built__text">
          ${caption ? `<p class="built__caption">${escapeHTML(caption)}</p>` : ""}
          <ul class="built__commits">
            ${commits.map((c) => `<li>${escapeHTML(c)}</li>`).join("")}
          </ul>
        </div>
      </li>`;
    })
    .join("");
  el.hidden = false;
  const count = t.totals?.commits ?? t.days.reduce((n, d) => n + d.commits.length, 0);
  $("#built-count").textContent = `· ${count} commits over ${t.days.length} day${t.days.length === 1 ? "" : "s"}`;

  // the two-column origin box: shown only once the owner has filled it in
  const boxes = $("#built-boxes");
  const before = String(STORY_BOXES.before ?? "").trim();
  const during = String(STORY_BOXES.during ?? "").trim();
  if (boxes && (before || during)) {
    boxes.querySelector('[data-slot="before"]').textContent = before;
    boxes.querySelector('[data-slot="during"]').textContent = during;
    boxes.hidden = false;
  }
}

wire();
coach.init();
setAuthMode("signin");
renderStoryTimeline();

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
