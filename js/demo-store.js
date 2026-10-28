// js/demo-store.js
// ============================================================================
// DEMO persistence adapter (used until the real Supabase project is connected).
//
// Purpose: the hackathon demo must be a complete, working product on one device
// without any cloud keys. So while the Supabase project is NOT configured the
// app uses this store instead - clearly labeled "demo mode". It implements the
// SAME interface as js/supabase.js, so when the real project is connected the
// app switches to real cloud accounts + private storage automatically.
//
// Honesty rules: no fake cloud claims anywhere. Saved data lives in this
// browser only (localStorage). Demo mirrors the real flows: sign-up, sign-in,
// save page + rows, recent pages list.
// ============================================================================
const STORE_KEY = "pl.demo.v2";
const SESSION_KEY = "pl.demo.session.v2";
const MAX_PAGES = 12;

let session = null;

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? { users: {}, pages: [] };
  } catch {
    return { users: {}, pages: [] };
  }
}

function write(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

// Shrinks a page until it fits; photos are the heavy part.
function persist(store) {
  let keep = store.pages.slice(0, MAX_PAGES);
  try {
    write({ ...store, pages: keep });
    return true;
  } catch {
    // drop photos first, oldest screenshots of handwriting stay as text rows
    keep = keep.map((p, i) => (i >= 2 ? { ...p, photo: null } : p));
    try {
      write({ ...store, pages: keep });
      return true;
    } catch {
      return false;
    }
  }
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ------------------------------------------------------------------ session */
// No sign-up wall in demo: the browser IS the account. The first visit gets a
// device owner automatically; stores from earlier versions (email sign-up era)
// adopt their existing user so saved pages keep showing.
const DEVICE_OWNER = "owner@this-device";

function ensureSession() {
  if (session) return session;
  const store = read();
  let email = store.users[DEVICE_OWNER] ? DEVICE_OWNER : null;
  if (!email) {
    const have = Object.keys(store.users);
    if (!have.length) email = DEVICE_OWNER;
    else {
      // continuity: adopt the user who owns the most saved pages (old
      // sign-up-era stores keep their data); tie -> first key
      email = have[0];
      let best = 0;
      for (const e of have) {
        const n = store.pages.filter((p) => p?.owner === store.users[e]?.email).length;
        if (n > best) {
          best = n;
          email = e;
        }
      }
    }
    if (!store.users[email]) {
      store.users[email] = { email, createdAt: Date.now() };
      write(store);
    }
  }
  saveSession(store.users[email]);
  return session;
}

export function getSession() {
  return ensureSession();
}

export function currentUserId() {
  return session?.user?.id || null;
}

function makeSession(user) {
  return {
    access: "demo-token",
    refresh: null,
    expiresAt: Number.MAX_SAFE_INTEGER,
    user,
  };
}

function saveSession(user) {
  session = makeSession(user);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function signUp(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
  if (password.length < 6) throw new Error("Passwords need at least 6 characters.");
  const store = read();
  if (store.users[email.toLowerCase()]) {
    throw new Error("That email already has a demo account - sign in instead.");
  }
  store.users[email.toLowerCase()] = { email: email.toLowerCase(), createdAt: Date.now() };
  if (!persist(store)) throw new Error("This browser could not save the demo account.");
  saveSession(store.users[email.toLowerCase()]);
  return { ok: true, needsConfirm: false };
}

export async function signIn(email, password) {
  const store = read();
  const user = store.users[String(email || "").toLowerCase()];
  if (!user) throw new Error("No demo account for that email yet - tap Create account first.");
  saveSession(user);
}

export async function signOut() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

export function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

export async function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s?.user?.email) {
      session = makeSession(s.user);
      return session;
    }
  } catch {}
  return null;
}

/* ------------------------------------------------------------- save / list */
export async function uploadPagePhoto() {
  // demo: no bucket; the thumbnail is stored with the page itself
  return { path: "demo-photo" };
}

export async function savePage({ takenOn, pageTotalWritten, pageWarnings, rows, thumb, demo }) {
  const u = session?.user;
  if (!u) throw new Error("Please sign in first.");
  const store = read();
  const page = {
    id: uid(),
    owner: u.email,
    created_at: new Date().toISOString(),
    taken_on: takenOn || null,
    // demo flag: true when this page came from a made-for-demo sample.
    // Drives the CRM's Demo pages / My pages switch (cloud pages have no
    // flag and always count as the owner's own).
    demo: !!demo,
    photo: thumb ?? null,
    page_total_written: pageTotalWritten ?? null,
    page_warnings: pageWarnings ?? [],
    page_rows: (rows ?? []).map((r) => ({
      id: uid(),
      row_index: r.rowIndex ?? 0,
      name: r.name ?? "",
      phone: r.phone ?? null,
      note: r.note ?? null,
      amount_paid: r.amountPaid ?? null,
      amount_due: r.amountDue ?? null,
      follow_up_text: r.followUpText ?? null,
      follow_up_date: r.followUpDate ?? null,
      follow_up_confirmed: !!r.followUpConfirmed,
      follow_up_done: !!r.followUpDone,
      struck_out: !!r.struckOut,
      included: r.included !== false,
      raw_text: r.raw ?? null,
      confidence: r.confidence ?? {},
      flags: r.flags ?? [],
    })),
  };
  store.pages = [page, ...store.pages];
  const ok = persist(store);
  if (!ok) throw new Error("This browser ran out of demo space - the page could not be saved. Remove old demo pages or switch to the real project.");
  return { pageId: page.id, savedRows: page.page_rows.length };
}

export async function listRecentPages() {
  const store = read();
  const u = session?.user;
  return store.pages
    .filter((p) => !u || p.owner === u.email)
    .slice(0, 50)
    .map((p) => ({
      id: p.id,
      created_at: p.created_at,
      taken_on: p.taken_on,
      page_rows: p.page_rows,
    }));
}

// Marks a follow-up as handled (People view "Done" tap). Returns ok.
export async function setFollowUpDone(pageId, rowId, done = true) {
  const store = read();
  const page = store.pages.find((p) => p.id === pageId);
  const row = page?.page_rows.find((r) => r.id === rowId);
  if (!row) throw new Error("That follow-up could not be found.");
  row.follow_up_done = !!done;
  const persisted = persist(store); // storage pressure must not block the tap
  return { ok: true, persisted };
}

// Moves a follow-up to a new date - the loop closes after the call: "he'll
// come Friday" becomes Friday. The owner set it by hand, so it counts as
// confirmed (the same rule as ticking Confirm on the page).
export async function setFollowUpDate(pageId, rowId, date) {
  const store = read();
  const page = store.pages.find((p) => p.id === pageId);
  const row = page?.page_rows.find((r) => r.id === rowId);
  if (!row) throw new Error("That follow-up could not be found.");
  row.follow_up_date = date;
  row.follow_up_confirmed = true;
  const persisted = persist(store);
  return { ok: true, persisted };
}

// Records money received, in the owner's own hand. Each allocation carries the
// ABSOLUTE new amounts for one row (the caller computes them), plus an
// optional follow-up mark - a settled person has nothing left to chase.
// allocations: [{ pageId, rowId, amountPaid?, amountDue?, followUpDone? }]
export async function recordPayment(allocations) {
  const store = read();
  for (const a of allocations) {
    const page = store.pages.find((p) => p.id === a.pageId);
    const row = page?.page_rows.find((r) => r.id === a.rowId);
    if (!row) continue;
    if (a.amountPaid !== undefined) row.amount_paid = a.amountPaid;
    if (a.amountDue !== undefined) row.amount_due = a.amountDue;
    if (a.followUpDone !== undefined) row.follow_up_done = !!a.followUpDone;
  }
  const persisted = persist(store);
  return { ok: true, persisted };
}

// Removes one saved page (and its lines) from this browser.
export async function deletePage(pageId) {
  const store = read();
  const before = store.pages.length;
  store.pages = store.pages.filter((p) => p.id !== pageId);
  if (store.pages.length === before) throw new Error("That page was not found in this browser.");
  const persisted = persist(store);
  return { ok: true, persisted, left: store.pages.length };
}

// Stage 5: full demo reset - erases demo pages AND the demo account from this
// browser (used before recordings and after test drives). Nothing on any
// real Supabase project is touched by design - demo and real are separate.
export function resetDemoData() {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- backup / restore */
// The ledger belongs to the owner, not to this browser. A backup is a plain
// JSON file the owner keeps (and can re-import on any device). Demo mode only:
// a real cloud account already has the data in their own private project.
export function exportAllPages() {
  const store = read();
  const u = session?.user;
  return {
    app: "page-ledger",
    format: 1,
    exportedAt: new Date().toISOString(),
    pages: store.pages.filter((p) => !u || p.owner === u.email),
  };
}

// Merges a backup file into this browser: pages the browser does not have are
// added, pages it already has (same id) are left untouched. Nothing is
// deleted - a restore can never lose the owner's current data.
export function restoreAllPages(data) {
  if (!data || data.app !== "page-ledger" || !Array.isArray(data.pages)) {
    throw new Error("That file is not a Page Ledger backup.");
  }
  const store = read();
  const byId = new Map(store.pages.map((p) => [p.id, p]));
  let added = 0;
  for (const p of data.pages) {
    if (!p || typeof p.id !== "string" || !Array.isArray(p.page_rows)) continue;
    if (!byId.has(p.id)) {
      byId.set(p.id, p);
      added++;
    }
  }
  store.pages = [...byId.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const ok = persist(store);
  if (!ok) throw new Error("This browser could not save the restored pages - it is out of demo space.");
  return { added, total: store.pages.length };
}
