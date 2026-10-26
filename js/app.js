// js/app.js
// ===========================================================================
// Page Ledger — Stage 1 controller.
// Views: upload -> loading -> review (or error). When the server reports
// demoMode, the UI says so instead of pretending to be live.
// Stage 1 saves nothing: this screen's job is a trustworthy read + review.
// ===========================================================================
import { resizeImageToJpeg } from "./resize.js";
import { extractPage } from "./api.js";
import { getConfig } from "./config.js";
import * as sb from "./supabase.js";
import * as demo from "./demo-store.js";

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

function showView(name) {
  for (const v of ["view-upload", "view-loading", "view-error", "view-review", "view-auth"]) {
    $(`#${v}`).hidden = v !== name;
  }
}

function setBadge() {
  const badge = $("#mode-badge");
  if (!state.demoMode) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = state.lastRequest?.mockFixture ? "Sample reading · demo" : "Demo data · mock";
}

function resetToUpload() {
  state.busy = false;
  state.demoMode = false;
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
  $("#review-summary").textContent = `${names.size} ${names.size === 1 ? "person" : "people"} · ${n} ${n === 1 ? "line" : "lines"} · due ₹${fmtMoney(b.due)} — check each line before keeping`;
  $("#review-totals").innerHTML = `
    <span class="stat"><span class="stat__label">People</span><span class="stat__value">${names.size}</span></span>
    <span class="stat"><span class="stat__label">Paid</span><span class="stat__value">&#8377;${fmtMoney(b.paid)}</span></span>
    <span class="stat"><span class="stat__label">Due</span><span class="stat__value">&#8377;${fmtMoney(b.due)}</span></span>`;
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

function inputHTML(row, key, label, type) {
  const isMoney = key === "amountPaid" || key === "amountDue";
  const value = key === "follow" ? row.follow.date : row.fields[key].value;
  const classes =
    key === "follow"
      ? ["field", lowClassForFollow(row)].filter(Boolean).join(" ")
      : fieldClasses(row, key);
  const hint = key === "follow" ? hintForFollow(row) : hintFor(row, key);
  const extras = isMoney ? 'inputmode="decimal" min="0" step="any"' : "";
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

  const rawLine = row.raw
    ? `<p class="rawline" data-rawid="${row.id}" hidden><code>${escapeAttr(row.raw)}</code></p>`
    : "";

  return `
  <div class="rowcard${row.struckOut ? " struck" : ""}${noAnim ? " no-anim" : ""}" role="listitem"${noAnim ? "" : ` style="--i:${index}"`} data-id="${row.id}">
    <div class="rowcard__top">
      <span class="rowcard__num">${index + 1}</span>
      <div class="rowcard__flags">${flagsHTML}</div>
      <div class="rowcard__tools">${struckToggle}${rawBtn}
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
      </div>
      ${rawLine}
    </div>
  </div>`;
}

/* re-render one row card in place, restoring focus + caret to the edited input */
function refreshRow(id, focusKey = null) {
  const idx = state.rows.findIndex((r) => r.id === id);
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
    return;
  }
  container.innerHTML = state.rows.map((r, i) => rowCardHTML(r, i)).join("");
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

function renderReview() {
  setBadge();
  renderRows();
  renderWarnings(state.extraction);
  updateTotals();
  resetSaveUi();
  setStageNotes();
  showView("view-review");
  window.scrollTo(0, 0);
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
  const sess = auth().getSession();
  $("#account-email").textContent = signedIn ? `${sess?.user?.email || ""}${state.demoStore ? " · demo" : ""}` : "";
  setStageNotes();
  showView("view-upload");
  if (signedIn) await loadRecent();
}

function showAuth() {
  $("#account").hidden = true;
  $("#btn-save").hidden = true;
  $("#review-note").textContent = state.demoStore
    ? "Sign in to save pages on this device (demo mode)."
    : "Sign in to save pages - your account, your data, protected by rules.";
  $("#auth-demo-note").hidden = !state.demoStore;
  $("#auth-note").textContent = state.demoStore
    ? "Demo mode: nothing leaves this device - no cloud yet. Pages save only in this browser."
    : "Your data is protected by database rules: no one else can read it, not even other accounts.";
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
  try {
    const pages = await auth().listRecentPages();
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
        </div>`;
      })
      .join("");
  } catch {
    list.innerHTML = `<p class="recent__empty">Could not load recent pages (offline?).</p>`;
  }
}

/* ------------------------------------------------------------- saving */
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

  // sample page from bundled fixtures (mock, zero credits)
  $("#btn-sample").onclick = async () => {
    if (state.busy) return;
    try {
      const res = await fetch("/fixtures/demo-pages/page1.jpg");
      if (!res.ok) throw new Error("The sample page photo could not be loaded.");
      const blob = await res.blob();
      await handleSelectedFile(blob, { mockFixture: "spike/page1" });
    } catch (e) {
      $("#error-msg").textContent = e.message || "The sample page could not be loaded.";
      $("#error-detail").hidden = true;
      showView("view-error");
    }
  };

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
    const t = e.target.closest("button[data-act='del']");
    if (!t) return;
    const row = state.rows.find((r) => r.id === t.dataset.id);
    if (!row) return;
    const label = row.fields.name.value || "this row";
    if (confirm(`Remove ${label}? (The notebook page stays untouched.)`)) {
      state.rows = state.rows.filter((r) => r.id !== row.id);
      renderRows();
      updateTotals();
    }
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
}

wire();
setAuthMode("signin");

(async function boot() {
  let cfg = null;
  try {
    cfg = await getConfig();
  } catch {}
  state.sbConfigured = !!cfg?.configured;
  if (!state.sbConfigured) {
    // No project keys yet: demo mode - accounts and saving work on this
    // device only (clearly labeled), so the demo is complete without keys.
    state.demoStore = true;
    const session = await demo.restoreSession().catch(() => null);
    if (session) await showSignedInHome();
    else showAuth();
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
