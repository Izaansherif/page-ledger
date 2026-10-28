// js/coach.js
// ============================================================================
// Skippable 3-step coach for first-time visitors (low-key, not a tour wall).
// It only ever POINTS at the real UI on the screen right now - it never blocks
// anything (overlay is see-through; taps pass through to the app underneath).
//
// Steps, in the order a first visit flows:
//   home   - point at the big "Try a sample notebook page" button
//   review - point at the check-the-read table (only after a read lands)
//   people - point at the people list (only after a first save lands there)
//
// State lives in localStorage ("pl.coach.v1"). "Skip coach" ends all steps.
// Reduced motion: the pulse class simply never gets added (CSS honors it too).
// ============================================================================

const STORE_KEY = "pl.coach.v1";

function read() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === "skip") return { done: true };
    return JSON.parse(raw || "{}") || {};
  } catch {
    return {};
  }
}

function write(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* private mode - the coach then just shows every visit; harmless */
  }
}

const STEPS = [
  {
    key: "home",
    // first-visit home only; on the auth wall (real mode) there is no button
    target: () => (document.getElementById("btn-sample-primary")?.offsetParent ? "#btn-sample-primary" : null),
    text: "Pick a sample page - it reads exactly like your own photo would. Free, no key needed.",
  },
  {
    key: "review",
    // point at the FIRST row of the check list - the whole list is too tall
    target: () => {
      const first = document.querySelector(".rowcard[data-id]");
      if (first && first.offsetParent) return ".rowcard[data-id]";
      // freshly added page may have no rows kept - point at the rows area
      return document.getElementById("rows")?.offsetParent ? "#rows" : null;
    },
    text: "These lines came from the photo. The AI only reads - you check, fix and confirm before anything changes.",
  },
  {
    key: "people",
    // top of the People screen: "Call today" if it has cards, else the list
    target: () => {
      const today = document.getElementById("today-block");
      if (today && !today.hidden && today.offsetParent) return "#today-block";
      return document.getElementById("people-list")?.offsetParent ? "#people-list" : null;
    },
    text: "Saved - now these are your people. Tap a name to send a WhatsApp reminder.",
  },
];

// the phone bottom bar tucks away while the coach points, comes back after
function reconcileBar(hidden) {
  const bar = document.getElementById("bottombar");
  if (bar) bar.hidden = hidden;
}

const ring = () => document.getElementById("coach-ring");
const tip = () => document.getElementById("coach-tip");

function placeAt(target, stepNo, text, done) {
  const box = document.getElementById("coach");
  const rEl = ring();
  const tEl = tip();
  const rect = target.getBoundingClientRect();
  const pad = 8;
  rEl.style.top = `${rect.top - pad + window.scrollY}px`;
  rEl.style.left = `${rect.left - pad + window.scrollX}px`;
  rEl.style.width = `${rect.width + pad * 2}px`;
  rEl.style.height = `${Math.min(rect.height + pad * 2, window.innerHeight * 0.9)}px`;

  // tip floats above the target when it fits, else below
  const tipH = tEl.offsetHeight || 74;
  const above = rect.top > tipH + 18;
  tEl.style.top = above
    ? `${Math.max(10 + window.scrollY, rect.top - tipH - 12 + window.scrollY)}px`
    : `${rect.bottom + 12 + window.scrollY}px`;
  tEl.style.left = `${Math.max(12, Math.min(rect.left + window.scrollX, window.innerWidth - tEl.offsetWidth - 12))}px`;

  document.getElementById("coach-text").textContent = text;
  document.getElementById("coach-step-no").textContent = `step ${stepNo} of 3`;
  box.hidden = false;
  reconcileBar(true);

  tEl.classList.toggle("coach__tip--pulse", !done && !matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function hide() {
  const box = document.getElementById("coach");
  if (box && !box.hidden) box.hidden = true;
  if (box) reconcileBar(false);
}

let currStep = null;

function showStep(i) {
  const st = read();
  if (st.done || i >= STEPS.length) {
    hide();
    return;
  }
  const step = STEPS[i];
  if (st[step.key]) return showStep(i + 1);
  const sel = typeof step.target === "function" ? step.target() : step.target;
  const target = sel ? document.querySelector(sel) : null;
  if (!target || target.hidden || target.closest("[hidden]")) {
    // its view is not on screen right now - the app will call the coach
    // again when the moment actually arrives
    hide();
    return;
  }
  currStep = i;
  placeAt(target, i + 1, step.text, st[step.key]);
}

export function isUnseen(key) {
  const st = read();
  if (st.done) return false;
  return !st[key];
}

export function step(key) {
  // show one step if unseen, without marking anything done
  const st = read();
  if (st.done) return;
  const i = STEPS.findIndex((s) => s.key === key);
  if (i === -1 || st[key]) return;
  showStep(i);
}

export function reach(key) {
  // milestone model: reaching a later step quietly marks every earlier one
  // done (the visitor is already past them), then shows the new step once.
  const i = STEPS.findIndex((s) => s.key === key);
  if (i === -1) return;
  const st = read();
  if (st.done) return;
  for (let k = 0; k < i; k++) st[STEPS[k].key] = true;
  write(st);
  if (st[key]) return; // already seen
  showStep(i);
}

export function complete() {
  // the visitor used the real UI (e.g. opened a reminder template) - done
  write({ done: true });
  hide();
}

export function skip() {
  write({ done: true });
  hide();
}

export function dismiss() {
  hide();
}

export function init() {
  const skipBtn = document.getElementById("coach-skip");
  if (skipBtn) skipBtn.onclick = skip;
  window.addEventListener("resize", () => {
    if (!document.getElementById("coach")?.hidden && currStep !== null) showStep(currStep);
  });
}
