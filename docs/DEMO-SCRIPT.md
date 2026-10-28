# Page Ledger — 3-minute demo video script

Target: the hackathon judging video (required, primary artifact).
Recording: laptop browser at 1280×720 minimum (phone layout can be shown at
the end in a side-by-side or a second window). Quiet room — one segment uses
the real microphone. Reset the demo BEFORE recording: press **Erase demo
pages** in the top bar (no sign-in exists in demo — the device *is* the
account), then save the sample page once so the video starts clean but ends
with data on screen.

Every label on screen says what is real: demo mode is announced by a badge
("Sample reading") and demo chips. Nothing hidden, no fake cloud.

---

## 0:00 – 0:20 · The problem (talking over the home screen)

> "This is my father's shop notebook — money in, money owed, and 'he said he
> will pay next Tuesday' scribbled in the margins. Finding who to call means
> flipping pages. Page Ledger turns ONE photo of a page into a working
> mini-CRM: customers, amounts, and who to chase today."

**On screen:** home hero. Keep the camera on the hero words + the sample button.

## 0:20 – 0:50 · Photo → checkable table (: the core trust idea)

1. **Try a sample page** → loading phases run.
2. Review table appears. say:
> "The AI reads the page — but nothing is saved yet. Every line is editable,
> struck-out lines are excluded, and blank fields stay blank. The AI never
> invents data; a human confirms."
3. Fix ONE row live: click a name cell, retype it (show editability).
4. Open **"How this page was read"** and point at the panel:
> "The app shows exactly what the AI did: lines kept, lines struck out, fields
> it could not read, average read confidence, and the exact cost of the read."

## 0:50 – 1:20 · Voice note + save

1. On a follow-up row, tap the **mic** and actually speak:
   *"Aishu said she will bring the four hundred this evening."*
2. The transcript fills the note field. Say:
> "Your own voice becomes text you can edit — never an AI-written message.
> This runs on Muse Voice Transcribe through our own serverless function."
3. Tick **Confirm** on the follow-up date, then **Save this page**.
4. Green "Saved" — say: "saved to the owner's account — because that page is
   private: database rules, not promises."

## 1:20 – 1:50 · People view + WhatsApp (the money moment)

1. The red **overdue strip** is sitting above the list if a promise is past due
   (Aishu P., "Thursday" read as the Thursday that just passed — flagged amber
   in review, confirmed at save). Tap it: "Show them" → the **Call today** list
   with the overdue regular first. Say:
> "Promises nobody marked done don't get lost — overdue sits on top, one tap."
2. Show: totals chips, the Call today list, the merged customer across pages
   (Anandettan's sugar line + promise line are one person), money due/paid.
3. Tap **Done** on a follow-up: the overdue strip clears with it.
4. Tap **WhatsApp message** on a debtor: the sheet opens with a pre-written
   reminder containing the real figure. Say:
> "We never message anyone. The owner reviews the words in this sheet and
> presses Send in WhatsApp themselves. Templates — not chatbots."

## 1:50 – 2:20 · Ask my ledger (grounded AI)

1. Tap **"Who owes me the most?"** → answer + "from your figures" chips.
2. Then **"Who should I chase today?"**. Say:
> "The model answers using ONLY figures computed from the owner's own pages —
> it shows exactly which figures it used, and says plainly if data is missing.
> No new numbers. No messages to customers."

## 2:20 – 2:35 · Honesty + how it's built (fast)

> "Everything you just saw ran on saved sample fixtures — zero API credits
> burned in the demo. The same code has a live mode pointed at the Meta Model
> API: verified endpoints, model names and pricing straight from the docs,
> every AI reply JSON-schema validated, retried once, grounded."
Show (quick): README status lines, then `netlify/functions/_lib/ai.js` scroll
for 3 seconds — the verified-facts header.

## 2:35 – 3:00 · Close

> "Small shops already run on paper. Page Ledger doesn't ask them to change —
> it reads what they already write, then quietly does the chores: totals,
> follow-ups, reminders. Built for the Meta Model API, works offline-of-cloud
> in demo mode, and my father's shop is the first install."

End card: repo URL (https://github.com/Izaansherif/page-ledger) + live URL
(https://pageledger.netlify.app/).

---

### Recording checklist

- [ ] Fresh demo state: Erase demo pages (top bar) → reload → save the sample
      ONCE so the recent strip shows ≥1 page before the recording continues.
- [ ] Mic tested once before take (the browser will ask permission — allow and
      keep it allowed, so no dialog appears mid-take).
- [ ] Do not show any real person's data: fixture/exported sample pages only.
- [ ] If the mock transcript doesn't match what you said — perfect, that's the
      demo honesty moment: 'Demo transcript filled' is labelled on screen, and
      in the saved-sample pages it fills with the matching Aishu line anyway.
- [ ] 3:00 hard cap. Practise segment 1:50–2:20 — it is the densest.
- [ ] Credits are safe by construction: sample-page reads are always served
      from saved fixtures in any mode (they never touch the API), and live
      own-photo reads are capped by `LIVE_CALLS_PER_MINUTE`/`LIVE_CALLS_PER_DAY`
      (default 8/min, 150/day) with a friendly fallback message. Say it in one
      line in the 2:20 honesty segment: "and a public demo can never run the
      key dry — the reads are capped, and the samples are free."

---

### Cue sheet — the exact click order, one take

Start: browser at 1280×720+, at `pageledger.netlify.app`, home hero visible.
**Before recording starts** (not filmed): double-check the demo state is
clean — press **Erase demo pages** (a confirm message appears; confirm) and
reload. Do this once, not on camera: the segment 0:00 opens on the hero.

| beat | seconds | what you do | note |
|---|---|---|---|
| 0 | 0:00–0:20 | nothing — voice-over on the hero | the 3D scene reacts to the pointer: move the mouse gently |
| 1 | 0:20–0:50 | click **Try a sample notebook page** (big green) | dental page reads; phases run ≈2.5s |
| 2 | | point at the follow-up row "planned 2026-10-27, confirm it" (amber) | the AI read the written Thursday as the one just passed — say it out loud |
| 3 | | tick its **Confirm** checkbox | cell flips to "Confirmed 2026-10-27" |
| 4 | | click **Confirm all clear lines** (above the table) | flag-free rows get checked |
| 5 | | click a name cell, retype the same words, press Enter | shows editability without changing any totals |
| 6 | | open **How this page was read** (below the table) | kept/struck lines, confidence, cost receipt; close it |
| 7 | 0:50–1:20 | click the row **mic**, speak ≈3s, click again to stop | the note fills, labelled "Demo transcript filled"; if the mic errors the app says type it — do that |
| 8 | | click **Save this page** | pulse + "Saved ✓"; People auto-lands with the red **overdue strip** |
| 9 | 1:20–1:50 | point at the strip → click **Show them** | switches to Call today: Aishu first, "overdue" badge |
| 10 | | click **Back** (top-left) → home → open the **kirana** sample card → tick Anandettan's follow-up **Confirm** → **Confirm all clear lines** → **Save** | two saved pages fill out totals; the strip shows again |
| 11 | | on People: Anandettan's card → **WhatsApp message** → read the pre-filled ₹395 reminder → click **Cancel** (never Send) | "Templates, not chatbots" lands here |
| 12 | | tap **Done** on a follow-up | the red strip clears with it |
| 13 | 1:50–2:20 | ask pills (**Who owes me the most?** → **Who should I chase today?**) | the answer numbers are the SAME ones in the People totals — point at both once |
