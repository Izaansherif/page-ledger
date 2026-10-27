# Page Ledger — Hackathon Submission (Meta Global AI Developer Hackathon, Oct 26–Nov 4 2026)

**Track:** Indie Developer (solo participant)
**Repo:** https://github.com/Izaansherif/page-ledger  (public — required by rules)
**Live URL:** ✅ https://pageledger.netlify.app/ (Netlify, auto-builds on every push to `main`; functions verified live — sample read, grounded ask, transcript all working)
**Demo video:** script ready — docs/DEMO-SCRIPT.md (record against the live URL above)
**Submission deadline:** Wed Nov 4, 9:00 PM ET via CV platform (Meta Global AI Developer Hackathon – Cerebral Valley)
**Problem statement:** Build for Your World — brings Meta's models into a domain I know firsthand (small-shop paper ledgers in India), frees up time, and makes something possible that wasn't before (photo-to-CRM in one tap).

## Build status (as of Oct 27)

- **Deployed**: the owner created the Netlify account and connected this repo - the site builds automatically on every push to `main`. Public URL: TBD (paste the site URL here and into the submission form before submitting).
- **Stages 0–7 done and pushed**: extraction pipeline, upload/review, demo-mode accounts + saving, People view + call-today + WhatsApp templates, voice follow-up notes, grounded trust panel, "Ask my ledger".
- **Stage-2 refinement done** (owner's polish round): the story section removed from the home; hero rebuilt as a true 3D scene (photographed page → real extraction JSON → mini-CRM phone); sample pages re-rendered to look photographed, not drawn (desk edges, pen bleed, handwritten Devanagari/Malayalam).
- **Stage-7 hardening done**: live-mode budget caps (`LIVE_CALLS_PER_MINUTE=8`, `LIVE_CALLS_PER_DAY=150`, env-tunable) so runaway traffic can't burn the key - capped reads/questions/voice fall back with a friendly message pointing at the sample pages; sample-page reads are always served from saved fixtures in any mode and never spend credits.
- Remaining (owner, not AI): paste the Netlify URL here, record the video with `docs/DEMO-SCRIPT.md`, fill the CV submission form. (Optional: real Supabase keys, then optional `AI_MODE=live` + `META_API_KEY` env vars on Netlify.)

## What was built during the hackathon (new work only)

Everything in this repo was built during the Oct 27–Nov 4 building period. Stages 0–7 of the project plan cover: AI extraction pipeline (Stage 0), upload + review table (Stage 1), Supabase auth/database/saving (Stage 2), CRM + money view (Stage 3), follow-ups + WhatsApp (Stage 4), trust/correctness checks (Stage 5), more Meta AI — Ask/Voice/Digest (Stage 6), polish + demo mode + README (Stage 7).

No code, data, or assets are used that we don't have rights to; all demo data and sample pages are fake (rule 7 in AGENTS.md).

## Meta AI tooling used (verified against dev.meta.ai/docs)

| Feature | Meta model | How it's used |
|---|---|---|
| Read notebook photo | `muse-spark-1.3` (image understanding) via Meta Model API, Chat Completions + structured output (JSON schema) | Photo → structured JSON rows (name, phone, paid, due, follow-up, flags, confidence) |
| Ask your business | `muse-spark-1.3` | The app computes a compact figures brief from the owner's own saved pages; the model turns question+brief into a validated JSON answer that cites the figures it used — numbers only from the brief, "data missing" allowed |
| Voice notes | `muse-voice-transcribe-1.0` (file endpoint POST /v1/asr/transcribe, WAV PCM16 24 kHz) | Owner dictates a follow-up note; transcript lands as EDITABLE text the owner checks before saving — no AI-written message is ever sent |
| Weekly digest | folded into "Ask my ledger" preset questions (`muse-spark-1.3`) | Same grounded answer path; app computes numbers, model only words them |
| (Stretch) Row highlight on photo | `muse-spark-1.3` perception grounding (normalized 0–1000 boxes) — cheaper than SAM 3.1; SAM 3.1 available as fallback | Highlight where each row came from on the original photo |

Auth: Bearer token `MODEL_API_KEY` at `https://api.meta.ai/v1`; all AI calls go through `netlify/functions/_lib/ai.js` with `AI_MODE=live|mock`. Demo runs in mock mode (fixtures) so no credits are burned; live mode verified end-to-end in mock and ready for a key. Live mode carries hard budget caps (`LIVE_CALLS_PER_MINUTE`, `LIVE_CALLS_PER_DAY`) with a friendly fallback to the sample flow — a public demo can never run the key dry.

## Data model (Supabase Postgres, RLS on every table)

customers, pages, ledger_entries, followups, notes, templates, settings, ai_usage — each with user_id, user-scoped RLS, indexes on user_id/customer_id/due_date. Private storage bucket for page photos.

## Submission checklist (to complete at submit time)

- [ ] Public repo link: https://github.com/Izaansherif/page-ledger
- [ ] Public live URL (Netlify)
- [ ] Public 3-minute demo video link (accessible without login)
- [ ] Written description (problem solved, how Meta models are used, tech stack)
- [ ] All contributors listed (solo: Izaansherif)
- [ ] Demo highlights only features built during the hackathon
- [ ] Credits claimed: $150 Meta Model API credits applied for via participant form by Nov 4 (credit card pre-auth required)

## Judging rubric awareness (0–10 per category)

- Impact (30%): real-world potential for India's small shop/clinic owners who run on notebooks
- Use of Meta AI Tooling (25%): image extraction, structured output, voice transcribe, grounded Q&A + digest — beyond a basic integration
- Technical Depth & Execution (20%): RLS, transactions, validation, retry-once, mock/live toggle, zero-dep frontend
- Demo (25%): 3-minute video walking messy photo → fixed row → saved → money screen → WhatsApp → ask → voice note → confirm
