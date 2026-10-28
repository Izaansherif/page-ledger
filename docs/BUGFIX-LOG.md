# Bugfix log — Phase 1 (verify + fix before redesign)

Walked every flow in a headless Chromium (no Playwright needed — the harness
already drives one): all 5 sample reads, own-photo upload, review edits +
undo, confirm-and-save, People view, WhatsApp sheet, Ask, erase/delete,
reload-with-data, sheets' keyboard behavior, and layout at 360px / 768px /
desktop. Fixed what was broken, committed each fix.

## Fixed in this phase

1. **Own photo in demo mode showed a lie.** An uploaded own photo in demo
   (no API key) 500'd with "The AI service did not respond. Please try
   again." — a fake outage message for a permanent state. Now the server
   returns an honest 400 (`mock_needs_fixture`): "Demo mode reads only the
   sample pages — your own photo needs the connected reading service", and
   the app adds "The saved sample pages read fully and cost nothing."
   (`_lib/ai.js`, `extract.js`, `app.js`)

2. **Rule-4 violation: unparseable model JSON skipped the retry.** When the
   model answered with prose instead of JSON, `callModel` threw past the
   retry wrapper — no retry, and the generic "did not respond" error text.
   Now both the extraction and ask wrappers treat a thrown parse error as a
   failed attempt, retry once, and end with the coded, honest
   `EXTRACTION_INVALID` / `ANSWER_INVALID`. Verified with a stubbed-fetch
   unit test: bad key → 401 wording; network down → friendly 500; garbage
   ×2 → one retry then the coded error; valid → `ok:true, retries:0`.
   (`_lib/ai.js`)

3. **Ask demo answers cited made-up figures** ("Alexander Biles, ₹2,430")
   contradicting the on-screen data. Now one fixture per question holds
   `{{TOKENS}}` filled from the real brief — the demo answer and its chips
   always match the People view. Also fixed a latent Stage-6 bug on the way:
   `ask.js` read `raw.today` while the client sends `todayCall`, so the
   who-to-chase list never reached the server (live mode included).
   (commit `bda6c74`)

4. **Mic demo transcript named a fictional person.** The canned voice-note
   fixture said "Alexander said he will come this week…"; it now matches the
   dental sample story and the narration line ("Aishu said she will bring
   the four hundred this evening…"). (commit `bda6c74`)

5. **95px horizontal scroll at 360px.** The appbar's right cluster ("Erase
   demo pages", "Sign out", the account email) overflowed narrow phones.
   Now the appbar wraps to two rows under 480px and the device-local email
   is hidden there. Verified: 0px overflow at 360px and 768px. (`styles.css`)

6. **Tap targets under the 44px minimum.** Nudge close 26px → 44px, undo
   toast buttons → 40px min-height, "Skip coach" 26px → 40px. (`styles.css`)

7. **Keyboard gaps in sheets.** The trust shield never returned focus on
   close (keyboard users were stranded); Tab could escape an open sheet into
   background content. Now closing returns focus to the opener and Tab is
   trapped inside the open sheet (msg + shield), Escape still closes.
   Verified programmatically. (`app.js`)

8. **Browser Back left the app.** Back from People or Review exited the site
   entirely. Every stable view is now one history entry
   (upload/review/people via hash), so Back/Forward walk the app's views.
   Verified with real tab back/forward. (`app.js`)

## Checked and found correct (no change)

- All five sample reads land with distinct, correct sums (dental ₹1,500,
  garage ₹1,950, tuition ₹1,800, kirana ₹515, the 1860 scan ₹810), photos
  load inline, and the 1860 page reads gracefully without per-line boxes.
- Arithmetic: due/paid totals, merge-by-phone (Anandettan ₹45 + ₹350 →
  ₹395 on one card), Call-today ordering, chips match sums.
- Delete a page: confirm dialog, strip and People totals update, empty
  state correct. Erase demo: confirm dialog, clean reset.
- Save pulse + haptic, demo badges and honest labels everywhere, review
  edits/undo, read-cache (~260ms second read).

## Known / deliberate (documented, not fixed)

- The dev server imports the functions at boot — restart `node
  dev-server.js` after editing anything in `netlify/functions/`.
- The transcribe path doesn't retry a 200-with-garbage response (the ASR
  output is free text, not schema'd JSON); it already ends in a friendly
  error and the app invites typing the note by hand.
- Live-mode failure paths are unit-tested with a stubbed fetch (no real key
  exists yet); the wiring is ready for one.
