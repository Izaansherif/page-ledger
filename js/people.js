// js/people.js
// ============================================================================
// Stage 3 - the story payoff: "Know who to call today."
//
// Pure logic, no DOM. Takes the list of saved pages (with their rows) and
// folds them into ONE list of people, each with:
//   - money in / money owed (from rows never crossed out or excluded)
//   - pages seen on, last activity
//   - the most urgent CONFIRMED follow-up that is not done yet
//
// Rules kept here:
//   - only follow-ups confirmed by a human count ("call today")
//   - crossed-out / excluded rows never enter totals
//   - rows without any name OR phone are folded into one honest "unmatched"
//     bucket so no money silently disappears
//   - reminder/thanks messages are FIXED templates (never AI-written); the
//     owner edits and sends them in WhatsApp themselves
// ============================================================================

/* ------------------------------------------------------------------ helpers */
export function fmtRupees(n) {
  return (n ?? 0).toLocaleString("en-IN");
}

// Device-local date as YYYY-MM-DD (the shop owner's "today").
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Normalise an Indian phone number for WhatsApp:
// "+91 98765 43210" | "9876543210" | "09876543210" -> 919876543210
export function waDigits(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null; // cannot message this number reliably
}

function nameKey(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dayOf(page) {
  return page.taken_on || String(page.created_at || "").slice(0, 10) || "";
}

/* -------------------------------------------------------------- aggregation */
export function buildPeople(pages) {
  const today = localToday();
  const map = new Map();
  const skipped = { count: 0, due: 0, paid: 0 };

  for (const page of pages) {
    const d = dayOf(page);
    for (const r of page.page_rows ?? []) {
      if (r.struck_out || r.included === false) continue; // excluded stays excluded
      const name = String(r.name ?? "").trim();
      const digits = waDigits(r.phone);
      const paid = Number(r.amount_paid) || 0;
      const due = Number(r.amount_due) || 0;

      // A person needs something to be found by: a phone (their number is
      // their identity across pages) or at least a readable name.
      if (!digits && !name) {
        skipped.count += 1;
        skipped.due += due;
        skipped.paid += paid;
        continue;
      }

      const key = digits ? `p:${digits}` : `n:${nameKey(name)}`;
      let p = map.get(key);
      if (!p) {
        p = {
          key,
          name: name || (digits ? `+${digits}` : ""),
          nameMissing: !name,
          phone: r.phone ?? null,
          digits, // null when unusable for WhatsApp
          paid: 0,
          due: 0,
          pageKeys: new Set(),
          lastOn: "",
          lastDueOn: "",
          followUps: [],
        };
        map.set(key, p);
      }
      p.paid += paid;
      p.due += due;
      p.pageKeys.add(page.id);
      if (d > p.lastOn) p.lastOn = d;
      if (due > 0 && d > p.lastDueOn) p.lastDueOn = d;
      if (r.follow_up_confirmed && r.follow_up_date && !r.follow_up_done) {
        p.followUps.push({
          date: r.follow_up_date,
          text: r.follow_up_text ?? "",
          pageId: page.id,
          rowId: r.id ?? null,
        });
      }
    }
  }

  const list = [...map.values()];

  // Second pass: the same PERSON often appears once with a phone (keyed by
  // number) and once without (keyed by name) - identical names merge, the
  // phone-carrying copy wins identity details.
  const out = [];
  const nameIdx = new Map();
  const mergeInto = (keep, drop) => {
    keep.paid += drop.paid;
    keep.due += drop.due;
    for (const k of drop.pageKeys) keep.pageKeys.add(k);
    keep.lastOn = drop.lastOn > keep.lastOn ? drop.lastOn : keep.lastOn;
    keep.lastDueOn = drop.lastDueOn > keep.lastDueOn ? drop.lastDueOn : keep.lastDueOn;
    if (!keep.digits && drop.digits) { keep.digits = drop.digits; keep.phone = drop.phone; }
    keep.nameMissing = keep.nameMissing && drop.nameMissing;
    if (!keep.name && drop.name) keep.name = drop.name;
    if (drop.followUps.length) keep.followUps.push(...drop.followUps);
  };
  for (const p of list) {
    if (p.nameMissing) { out.push(p); continue; }
    const k = nameKey(p.name);
    const e = nameIdx.get(k);
    if (e) mergeInto(e, p);
    else { nameIdx.set(k, p); out.push(p); }
  }

  const all = out.map((p) => {
    p.pagesCount = p.pageKeys.size;
    delete p.pageKeys;
    // most urgent un-done follow-up: the earliest date
    p.followUps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    p.followUp = p.followUps[0] ?? null;
    p.toCall = !!(p.followUp && p.followUp.date <= today);
    // WhatsApp quality: number present and plausible, or nothing to tap
    p.waOk = !!p.digits;
    delete p.followUps;
    return p;
  });

  const toCall = all.filter((p) => p.toCall).sort((a, b) => (a.followUp.date < b.followUp.date ? -1 : 1));
  const rest = all
    .filter((p) => !p.toCall)
    .sort((a, b) => (a.lastOn > b.lastOn ? -1 : a.lastOn < b.lastOn ? 1 : 0));

  const totals = {
    due: all.reduce((s, p) => s + p.due, 0),
    paid: all.reduce((s, p) => s + p.paid, 0),
    toCall: toCall.length,
    people: all.length,
  };
  return { toCall, rest, all, totals, skipped: skipped.count ? skipped : null };
}

/* ------------------------------------------------------------- templates */
// Pre-written message skeletons (project rule 6: no AI-written customer
// messages). The owner sees, edits and sends everything themselves.
export function fillTemplate(kind, person) {
  const hi = person.nameMissing ? "Hello," : `Hello ${person.name},`;
  if (kind === "thanks") {
    return `${hi} payment received${person.paid ? ` - ₹${fmtRupees(person.paid)}` : ""} noted in my ledger. Thank you!`;
  }
  // reminder (default)
  const due = person.due > 0 ? `₹${fmtRupees(person.due)}` : "the pending amount";
  const from = person.lastDueOn ? ` (page of ${person.lastDueOn})` : "";
  return `${hi} a gentle reminder from my notebook: ${due}${from} is still pending. Please settle it when convenient. Thank you!`;
}

export const TEMPLATE_KINDS = [
  { id: "reminder", label: "Payment reminder" },
  { id: "thanks", label: "Payment thanks" },
];
