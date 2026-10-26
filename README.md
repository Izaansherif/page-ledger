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
- **Stage 1 done** - upload screen, extraction function, full review table (nothing saved yet)
- Demo path needs **no Meta API key**: mock mode serves fixtures (zero credits); live mode is wired and ready for a key

## Run the app (Stage 1)

```
node dev-server.js     #  ->  http://localhost:8888
```

Open http://localhost:8888 in a browser (on your phone over the same Wi-Fi, use this PC's IP, e.g. `http://192.168.x.x:8888`).

- **Add a notebook page** opens the camera on a phone (`capture="environment"`); drag-and-drop works on desktop.
- Images are resized in the browser (long edge 1600px, JPEG q0.8) before upload.
- **Try a sample page** runs the whole flow on a bundled public-domain ledger scan with matching fixture data (mock mode, zero credits).
- The review screen shows the photo beside the editable table: amber = "AI was unsure, check this", red = bad phone; crossed-out rows stay excluded until you tick "keep"; follow-up dates must be confirmed by hand. Nothing is saved in Stage 1 - saving arrives with Supabase in Stage 2.
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
