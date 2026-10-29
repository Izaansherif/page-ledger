# Page Ledger — 3-minute demo video script

Target: the hackathon judging video (required, primary artifact).
Recording: laptop browser at 1280×720 minimum (phone layout can be shown at
the end in a side-by-side or a second window). Quiet room — one segment uses
the real microphone.

Reset the demo BEFORE recording: **More menu (⋯) → Erase demo pages** (no
sign-in exists in demo — the device *is* the account), reload, and let the
story play once so the recording opens the way a judge's first visit does.

Every label on screen says what is real: demo mode is announced by a badge
("Sample reading") and demo chips. Nothing hidden, no fake cloud.

---

## 0:00 – 0:20 · The story (the why, in five scenes)

The app opens on the story: five short scenes, tap to advance (or let the
tap-clicks fall on the beat of the narration).

> "This one is for the dukandars — the shopkeepers who kept our streets
> running when everything shut. Shukriya. Nandi. Thank you."

Scene 2 (the notebook turning): "Every day they wrote it all down. Who took
what. Who owes what. Who pays on Friday."

Scene 3 (pages blur, a promise slips away): "Paper is hard to track.
Promises get lost between pages." *(the owner's own line sits here)*

Scene 4 (the light sweep): "So keep the notebook. Just photograph the page."

Scene 5 (three chips): "AI reads. You check every line. Nothing is sent
without you."

**On screen:** the story scenes. End the segment as the landing appears:
"Your notebook, turned into a CRM."

## 0:20 – 0:30 · Landing → demo picker

1. **View demo** → the five sample pages as large cards.
> "Five made-for-demo pages — a dental clinic, a garage, a kirana khata,
> tuition fees, and an 1860s museum scan. Tap one and it reads."

Point at one card's label for one breath:
> "Each card states exactly what it replays: the real reading, the day it was
> recorded, and the model that did it — meta-models/Muse-Spark-Open-816B-A42B."

## 0:30 – 1:00 · Photo → checkable table (the core trust idea)

1. Pick the **dental clinic** card → loading phases run.
2. Review table appears. Say:
> "The AI reads the page — but nothing is saved yet. Every line is editable,
> struck-out lines are excluded, and blank fields stay blank. The AI never
> invents data; a human confirms."
3. Fix ONE row live: click a name cell, retype it (show editability).
4. Open **"How this page was read"** and point at the panel:
> "The app shows exactly what the AI did: lines kept, lines struck out, fields
> it could not read, average read confidence, and the exact cost of the read."

## 1:00 – 1:30 · Voice note + confirm

1. On a follow-up row, tap the **mic** and actually speak:
   *"Aishu said she will bring the four hundred this evening."*
2. The transcript fills the note field. Say:
> "Your own voice becomes text you can edit — never an AI-written message.
> This runs on Muse Voice Transcribe through our own serverless function."
3. Tick **Confirm** on the follow-up date, then **Confirm and open my CRM**.
4. Green "Saved" — say: "saved to the owner's own space — on this device in
   demo mode, or the owner's private account when the cloud is linked."

## 1:30 – 2:00 · The CRM (the money moment)

1. Three big numbers first: **To call / Total due / Collected**. Say:
> "The CRM writes itself: who to call today, what is owed, what came in."
2. Tap the **To call** card itself — the list filters to today's calls; tap
   again and it releases. One line: "The stats ARE the filters."
3. The follow-up beat: the page's own promise was *"coming Friday"*, so the
   saved state shows it on the person card (**Follow-up · Fri, 30 Oct**) and
   in **To call** from that day — amber when due, red the day after:
   "Promises nobody marked done don't get lost — overdue sits on top, one
   tap." *(If the overdue strip isn't red yet on recording day, say the line
   on Anandettan's card instead — the state ages into overdue on its own,
   exactly like a real ledger.)*
4. Tap a person → the **side panel**: their whole history, then **Call** and
   **WhatsApp**. Say:
> "We never message anyone. The owner reviews the words in this sheet and
> presses Send in WhatsApp themselves. Templates — not chatbots."
5. Still in the panel, the follow-up: **"He said another day? Move it"** →
   tap **Tomorrow** (or pick a date). Say:
> "This is the part after the phone call — he says Friday, you tap Friday.
> The app remembers, and Undo brings yesterday's date back."
6. Then the ending that matters: **Record payment** → **Full ₹395** → **Save**.
   Say:
> "And when he actually pays — one tap. The money moves from Due to Collected,
> the follow-up closes itself, and Undo brings the ledger back if your finger
> slipped."
7. Undo it back (keep the demo state: ₹395 due, the follow-up alive), then
   point at the **Demo pages / My pages** switch:
> "Sample pages and your own photographs stay clearly separated."

## 2:00 – 2:25 · Ask my ledger (grounded AI)

1. Tap **"Who owes me the most?"** → answer + "from your figures" chips.
2. Then **"Who should I chase today?"**. Say:
> "The model answers using ONLY figures computed from the owner's own pages —
> it shows exactly which figures it used, and says plainly if data is missing.
> No new numbers. No messages to customers."

## 2:25 – 2:40 · Honesty + how it's built (fast)

> "Everything you just saw ran on saved sample fixtures — zero API credits
> burned in the demo. The same code has a live mode pointed at the Meta Model
> API: verified endpoints, model names and pricing straight from the docs,
> every AI reply JSON-schema validated, retried once, grounded."
Show (quick): README status lines, then `netlify/functions/_lib/ai.js` scroll
for 3 seconds — the verified-facts header.

Then, one breath, **More (⋯)**: "And the ledger belongs to the owner — one tap
downloads every line as a spreadsheet, or a backup file that restores on any
device. Nothing is uploaded anywhere." (CSV + Backup visible in the menu; no
need to actually download on camera.)

## 2:40 – 3:00 · Close

> "Small shops already run on paper. Page Ledger doesn't ask them to change —
> it reads what they already write, then quietly does the chores: totals,
> follow-ups, reminders. Built for the Meta Model API, works offline-of-cloud
> in demo mode, and my father's shop is the first install."

End card: repo URL (https://github.com/Izaansherif/page-ledger) + live URL
(https://pageledger.netlify.app/).

---

### Recording checklist

- [ ] Fresh demo state: **More (⋯) → Erase demo pages** → reload → the story
      plays → land on the new landing → save the sample ONCE so the CRM has
      data before the recording continues (tick **Confirm** on the follow-up
      row — the CRM only counts follow-ups a human confirmed).
- [ ] The story is skipped automatically for returning visitors — to show it
      again mid-take use **More (⋯) → Replay the intro** (no erase needed).
- [ ] Mic tested once before take (the browser will ask permission — allow and
      keep it allowed, so no dialog appears mid-take).
- [ ] Do not show any real person's data: fixture/exported sample pages only.
- [ ] If the mock transcript doesn't match what you said — perfect, that's the
      demo honesty moment: 'Demo transcript filled' is labelled on screen, and
      in the saved-sample pages it fills with the matching Aishu line anyway.
- [ ] 3:00 hard cap. Practise segment 1:30–2:00 — it is the densest.
- [ ] Credits are safe by construction: sample-page reads are always served
      from saved fixtures in any mode (they never touch the API), and live
      own-photo reads are capped by `LIVE_CALLS_PER_MINUTE`/`LIVE_CALLS_PER_DAY`
      (default 8/min, 150/day) with a friendly fallback message. Say it in one
      line in the 2:25 honesty segment: "and a public demo can never run the
      key dry — the reads are capped, and the samples are free."
