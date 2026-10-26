// js/supabase.js
// ============================================================================
// Minimal, dependency-free Supabase REST client (Stage 2).
//
// Why hand-rolled? The project keeps a zero-dependency promise - the Supabase
// JS SDK would be the single npm/CDN dependency. The REST surface we need is
// small and stable:
//   auth:    POST /auth/v1/signup, /auth/v1/token, GET /auth/v1/user
//   storage: POST /storage/v1/object/page-photos/<uid>/<pageId>.jpg
//   db:      POST /rest/v1/pages, /rest/v1/page_rows  (RLS protects everything)
//
// All calls carry the publishable key in `apikey`; signed-in calls add
// `Authorization: Bearer <access_token>`. A dead token refreshes once, then
// the session clears and the app shows sign-in again.
// ============================================================================
import { getConfig } from "./config.js";

const SESSION_KEY = "pl.session.v1";

let session = null; // { access, refresh, expiresAt(ms), user }

/* ------------------------------------------------------------------ state */
export function getSession() {
  return session;
}

export function currentUserId() {
  return session?.user?.id || null;
}

function saveSession(raw) {
  if (!raw?.access_token) return;
  session = {
    access: raw.access_token,
    refresh: raw.refresh_token,
    expiresAt: Date.now() + Number(raw.expires_in ?? 3600) * 1000,
    user: raw.user ?? null,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

function storageGet() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s?.access && s?.user?.id) return s;
  } catch {}
  return null;
}

/* ----------------------------------------------------------------- helpers */
async function call(path, { method = "GET", body = null, auth = false, contentType = "application/json", extraHeaders = {} } = {}) {
  const { url, publishable } = await getConfig();
  const headers = { apikey: publishable, ...extraHeaders };
  if (contentType) headers["Content-Type"] = contentType;
  if (auth && session?.access) headers.Authorization = `Bearer ${session.access}`;

  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body == null ? undefined : typeof body === "string" ? body : body instanceof Blob ? body : JSON.stringify(body),
  });

  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => ({})) : await res.text();
  return { res, data };
}

async function withFreshToken() {
  // refresh proactively when the token is near expiry
  if (session && session.expiresAt - Date.now() < 60_000) {
    const { res, data } = await call("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh },
    });
    if (res.ok && data?.access_token) saveSession(data);
    else clearSession();
  }
}

/* -------------------------------------------------------------------- auth */
export async function signUp(email, password) {
  const { res, data } = await call("/auth/v1/signup", { method: "POST", body: { email, password } });
  if (!res.ok) throw new Error(friendlyAuthError(data, res.status));
  if (data?.access_token) {
    saveSession(data);
    return { ok: true, needsConfirm: false };
  }
  return { ok: true, needsConfirm: true }; // "check your email to confirm"
}

export async function signIn(email, password) {
  const { res, data } = await call("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  if (!res.ok) throw new Error(friendlyAuthError(data, res.status));
  saveSession(data);
}

export async function signOut() {
  try {
    await withFreshToken();
    await call("/auth/v1/logout", { method: "POST", auth: true, body: {} });
  } catch {}
  clearSession();
}

function friendlyAuthError(data, status) {
  const msg = String(data?.msg || data?.error_description || data?.error || data?.message || "");
  if (/invalid login credentials/i.test(msg)) return "Email or password is wrong. Try again.";
  if (/at least 6 characters/i.test(msg) || /password.*6/i.test(msg)) return "Passwords need at least 6 characters.";
  if (/already registered|already exists/i.test(msg)) return "That email already has an account - sign in instead.";
  if (/A user with this email/i.test(msg)) return "That email is already signed up - sign in instead.";
  if (/rate|too many/i.test(msg)) return "Too many tries - wait a couple of minutes.";
  if (res.statusText === undefined) return "Could not reach the sign-in service.";
  return msg ? `Sign-in problem: ${msg}` : `Sign-in problem (HTTP ${status}). Check your internet and try again.`;
}

/* -------------------------------------------------------------- boot/validate */
export async function restoreSession() {
  const stored = storageGet();
  if (!stored) return null;
  session = stored;
  await withFreshToken();
  if (!session?.access) return null;
  const { res, data } = await call("/auth/v1/user", { auth: true });
  if (!res.ok || !data?.id) {
    clearSession();
    return null;
  }
  session.user = data; // fresh profile fields
  saveSession({ access_token: session.access, refresh_token: session.refresh, expires_in: Math.max(60, Math.round((session.expiresAt - Date.now()) / 1000)), user: data });
  return session;
}

/* ----------------------------------------------------------------- storage */
// Uploads a Blob under <uid>/<pageId>.jpg ; returns { path }.
export async function uploadPagePhoto(pageId, jpegBlob) {
  await withFreshToken();
  const uid = currentUserId();
  if (!uid) throw new Error("Please sign in first.");
  const path = `page-photos/${uid}/${pageId}.jpg`;
  const { res, data } = await call(`/storage/v1/object/${path}`, {
    method: "POST",
    auth: true,
    contentType: "image/jpeg",
    body: jpegBlob,
  });
  if (!res.ok) {
    const msg = data?.message || data?.error || "";
    throw new Error(`The photo could not be saved (${res.status}). ${msg}`.trim());
  }
  return { path: `${uid}/${pageId}.jpg` };
}

/* ---------------------------------------------------------------------- db */
// Inserts the page, then its rows as one batch. Returns saved page id.
export async function savePage({ photoPath, takenOn, pageTotalWritten, pageWarnings, rows, userId }) {
  await withFreshToken();
  const { res: rp, data: page } = await call("/rest/v1/pages?select=id", {
    method: "POST",
    auth: true,
    extraHeaders: { Prefer: "return=representation" },
    body: {
      owner: userId,
      photo_path: photoPath,
      taken_on: takenOn || null,
      page_total_written: pageTotalWritten ?? null,
      page_warnings: pageWarnings ?? [],
    },
  });
  if (!rp.ok || !page?.[0]?.id) {
    throw new Error(`Saving the page failed (${rp.status}). Try again.`);
  }
  const pageId = page[0].id;

  const payload = rows.map((r, i) => ({
    page_id: pageId,
    owner: userId,
    row_index: r.rowIndex ?? i,
    name: r.name ?? "",
    phone: r.phone ?? null,
    note: r.note ?? null,
    amount_paid: r.amountPaid ?? null,
    amount_due: r.amountDue ?? null,
    follow_up_text: r.followUpText ?? null,
    follow_up_date: r.followUpDate ?? null,
    follow_up_confirmed: !!r.followUpConfirmed,
    struck_out: !!r.struckOut,
    included: r.included !== false,
    raw_text: r.raw ?? null,
    confidence: r.confidence ?? {},
    flags: r.flags ?? [],
  }));

  const { res: rr } = await call("/rest/v1/page_rows", { method: "POST", auth: true, body: payload });
  if (!rr.ok && rr.status !== 201) {
    throw new Error(`Saving the lines failed (${rr.status}). Try again.`);
  }
  return { pageId, savedRows: payload.length };
}

// Pages with their rows, newest first (used by the home strip and People view).
export async function listRecentPages() {
  await withFreshToken();
  if (!session?.access) return [];
  const { res, data } = await call(
    "/rest/v1/pages?select=id,created_at,taken_on,page_rows(id,name,phone,amount_paid,amount_due,struck_out,included,follow_up_text,follow_up_date,follow_up_confirmed,follow_up_done)&order=created_at.desc&limit=100",
    { auth: true },
  );
  if (!res.ok) return [];
  return data ?? [];
}

// People view "Done" tap on a follow-up.
export async function setFollowUpDone(rowId, done = true) {
  await withFreshToken();
  if (!session?.access) throw new Error("Please sign in first.");
  const { res } = await call(`/rest/v1/page_rows?id=eq.${encodeURIComponent(rowId)}`, {
    method: "PATCH",
    auth: true,
    extraHeaders: { Prefer: "return=minimal" },
    body: { follow_up_done: !!done },
  });
  if (!res.ok) throw new Error(`Could not update the follow-up (${res.status}). Try again.`);
  return { ok: true };
}

// Removes one page and its lines. RLS scopes both tables to the signed-in
// owner, so a crafted id can only ever delete the owner's own page.
export async function deletePage(pageId) {
  await withFreshToken();
  if (!session?.access) throw new Error("Please sign in first.");
  const id = encodeURIComponent(pageId);
  // lines first: harmless if the schema already cascades, safe if it does not
  const { res: rRows } = await call(`/rest/v1/page_rows?page_id=eq.${id}`, {
    method: "DELETE",
    auth: true,
    extraHeaders: { Prefer: "return=minimal" },
  });
  const { res: rPage } = await call(`/rest/v1/pages?id=eq.${id}`, {
    method: "DELETE",
    auth: true,
    extraHeaders: { Prefer: "return=minimal" },
  });
  if (!rPage.ok) throw new Error(`Removing the page failed (${rPage.status}). Try again.`);
  return { ok: true };
}
