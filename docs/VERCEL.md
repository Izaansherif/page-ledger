# Running Page Ledger on Vercel

This branch (`vercel-version`) is the same app, set up to run on Vercel.
The Netlify setup on `main` is untouched.

## What was changed (only this)
- `api/` - four small files (`extract`, `config`, `transcribe`, `ask`) that call
  the same handlers in `netlify/functions/`. `api/_adapt.js` converts between
  Vercel's request format and the one the handlers expect.
- `vercel.json` - timeout of 60s for the AI read, bundles `fixtures/` with the
  functions (so demo mode works), the three short URLs (`/extract`,
  `/transcribe`, `/ask`) and the same security headers as `netlify.toml`.
- `js/api.js` and `js/config.js` - the app now calls `/api/...` instead of
  `/.netlify/functions/...`.
- `dev-server.js` - also accepts `/api/...` so local testing still works.

## Steps
1. Go to vercel.com, sign in with GitHub, click **Add New... > Project**.
2. Import `Izaansherif/page-ledger` and choose the branch `vercel-version`
   (Settings > Git > Production Branch).
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty.
4. Open **Settings > Environment Variables** and add these names yourself,
   typing the values in Vercel only (never in chat, never in the repo):
   `AI_MODE`, `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME`, `META_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE`, `SUPABASE_SECRET`.
   Keep `AI_MODE=mock` for a free demo, or `live` for real AI reads.
5. **Deploy**, then open the Vercel link on your phone and click the main flow.

## Limits to know
- Vercel accepts request bodies up to about 4.5 MB. Photos are resized in the
  browser first (about 1 MB), so this is fine for normal use.
- Free (Hobby) plan functions may time out sooner than 60s. If a photo read
  fails with a timeout, that is the plan limit, not a bug.
- Update the web address in `index.html` (share-card meta tags), the README and
  your submission if you switch the public link to Vercel.
