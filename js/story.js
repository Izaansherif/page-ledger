// js/story.js
// ============================================================================
// The 5-scene story opening: dedication → the notebook → the hard part →
// the idea → you stay in charge. Then the product (the landing view).
//
// Shown ONCE per browser (localStorage inside try/catch - a blocked store
// means the story never shows, which is the safe fallback). "Skip to demo"
// is visible on every scene. Reduced motion: the scenes render as a plain
// stacked list (class story--static) instead of a full-screen takeover.
// ============================================================================
const KEY = "pl.story.v1";

const $ = (sel) => document.querySelector(sel);

let scenes = [];
let dots = [];
let idx = 0;
let onDone = null;

export function storySeen() {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return true; // storage blocked: never block the app for a story
  }
}

export function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function setScene(i) {
  idx = Math.max(0, Math.min(scenes.length - 1, i));
  scenes.forEach((s, n) => s.classList.toggle("story-scene--on", n === idx));
  dots.forEach((d, n) => d.classList.toggle("story-dot--on", n <= idx));
}

function close() {
  try {
    localStorage.setItem(KEY, "done");
  } catch {}
  const root = $("#story");
  root.hidden = true;
  document.body.classList.remove("story-open");
  const done = onDone;
  onDone = null;
  if (done) done(); // app hands control back: show the landing, coach, focus
}

export function openStory(finish) {
  const root = $("#story");
  if (!root) return;
  onDone = finish ?? null;
  scenes = [...root.querySelectorAll(".story-scene")];
  dots = [...root.querySelectorAll(".story-dot")];
  root.classList.toggle("story--static", reducedMotion());
  root.hidden = false;
  document.body.classList.add("story-open"); // CSS hides appbar + bottom bar
  setScene(0);
  root.focus({ preventScroll: true });
}

export function initStory() {
  const root = $("#story");
  if (!root) return;
  root.tabIndex = -1;

  // tap anywhere to advance; the skip button ends the story
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-story-skip]")) {
      close();
      return;
    }
    if (root.classList.contains("story--static")) return; // it reads as a page
    if (idx >= scenes.length - 1) close();
    else setScene(idx + 1);
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (root.classList.contains("story--static")) return;
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (idx >= scenes.length - 1) close();
      else setScene(idx + 1);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setScene(idx - 1);
    }
  });
}
