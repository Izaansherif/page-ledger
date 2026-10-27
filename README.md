# Page Ledger

A photo of a paper shop notebook becomes a working mini-CRM: customers, phone
numbers, money owed and received, follow-up lists - and WhatsApp in one tap.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 - Nov 4, 2026,
Indie Developer track). All AI runs on the **Meta Model API** (Muse Spark for reading
photos and answering questions, Muse Voice Transcribe for voice notes).

- Stack: plain HTML/CSS/JS (ES modules) + Supabase + Netlify Functions. **Zero npm dependencies.**
- Project plan and rules for agents: see `AGENTS.md`.

## Status

- **Stage 0 done** - AI spike, mock pipeline verified end-to-end
- **Stage 1 done** - upload screen, extraction function, full review table
- **Stage 2 done, demo form** - saving + recent pages work today via the
  on-device demo store; **no sign-in wall in demo** (this browser is the
  account); the real Supabase project connects at the end with
  `docs/SUPABASE-STEPS.md`
- **Stage 3 done** - People view: who to call today, WhatsApp pre-written templates the owner sends themselves
- **Stage 4 done** - voice follow-up notes: tap the mic, it becomes editable text (Muse Voice Transcribe; mock fixture until a key exists)
- **Stage 5 done** - trust panel ("How this page was read": kept/struck lines, blank fields, read confidence, cost receipt), remove a saved page, one-tap demo reset
- **Stage 6 done** - "Ask my ledger": grounded owner Q&A that cites exactly which figures it used (mock answer labeled demo until a key exists)
- **Demo sections 1-4 done** - sample-first home + coach; realistic sample pages; interactive rows (photo locate, one-tap confirm, undo), people search/history, typed ask; the real build story from `git log` (`node scripts/make-timeline.js`, captions from the owner in `js/story-notes.js`, see `docs/STORY-NOTES.md`)
- Demo path needs **no Meta API key** and no Supabase project: mock mode serves fixtures (zero credits); live mode is wired and ready for a key

## How saving works right now

- **No Supabase project connected?** The app runs in clearly-labeled
  **demo mode**: pages save and the People view fills up, but
  everything is stored **only in this browser** on this device — and there
  is **no sign-in wall**: the first visit quietly makes a "this device"
  owner. Ideal for a demo of the full loop.
- **Connecting the real project:** follow `docs/SUPABASE-STEPS.md` - exact,
  click-by-click, nothing to install. After that, accounts are real and pages
  + photos go to the user's private cloud account under database rules.

## Run the app

**Easiest way (anyone):** double-click **`Start Page Ledger.bat`** in this
folder. A black window opens and the app opens at http://localhost:8888.
Keep the black window open while using the app. Double-click it again later
and it politely says "already running" instead of erroring.

*(If you ever open `index.html` directly as a file, the app shows a card
with these same instructions instead of a broken page.)*

Command-line way (same thing):

```
node dev-server.js     #  ->  http://localhost:8888
```

Open http://localhost:8888 in a browser (on your phone over the same Wi-Fi, use this PC's IP, e.g. `http://192.168.x.x:8888`).

- **Add a notebook page** opens the camera on a phone (`capture="environment"`); drag-and-drop works on desktop.
- Images are resized in the browser (long edge 1600px, JPEG q0.8) before upload.
- **Try a sample page** runs the whole flow on a bundled public-domain ledger scan with matching fixture data (mock mode, zero credits).
- The review screen shows the photo beside the editable table: amber = "AI was unsure, check this", red = bad phone; crossed-out rows stay excluded until you tick "keep"; follow-up dates must be confirmed by hand.
- The console logs latency, retries, token usage and estimated cost for every page read.

## Run the spike (Stage 0, terminal)

```
node scripts/spike-extract.js test-pages/page1.jpg --mock
```

Live mode (burns a few hundredths of a cent per page):

1. Put your key in `.env` as `META_API_KEY=...` and set `AI_MODE=live`.
2. Drop 3 notebook photos into `test-pages/`.
3. `node scripts/spike-extract.js test-pages/page1.jpg`

## Hackathon

Meta Global AI Developer Hackathon (Oct 26–Nov 4 2026), Indie Developer track, solo participant.
- Problem statement: **Build for Your World** — Meta's models into small-shop paper ledgers in India.
- Meta models used: `muse-spark-1.3` (image extraction, structured output Q&A, weekly digest), `muse-voice-transcribe-1.0` (voice notes). All calls through `netlify/functions/_lib/ai.js`, `AI_MODE=live|mock`. Demo runs in **mock mode** (fixtures, zero credits); live mode is wired and ready for a key.
- Submission: public repo ✅ (https://github.com/Izaansherif/page-ledger), public live URL (Netlify, Stage 7), 3-minute demo video (docs/DEMO-SCRIPT.md, Stage 7), due **Wed Nov 4, 9:00 PM ET** via the CV platform.
- See `docs/SUBMISSION.md` for the full submission checklist and judging-rubric mapping.
