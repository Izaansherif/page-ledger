PROJECT: Pagebook. Turns photos of paper notebooks/ledgers into a working mini-CRM for small businesses.
USER: a small business owner in India (clinic, garage, shop, tuition). Not technical. Uses a phone or tablet. Notes may mix English, Hindi and Malayalam. Currency is ₹.
CONTEXT: built for the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026), Indie track. The AI in the app must run on the Meta Model API.

STACK (do not add anything else without asking me):
- Plain HTML/CSS/JS with ES modules. No framework, no build step unless essential.
- Supabase: auth, Postgres, private storage, row level security.
- Netlify Functions (Node) for ALL AI calls. Hosting on Netlify.
MACHINE: low-spec Windows laptop (8 GB RAM, little disk). No Docker, no local models, no heavy installs, keep node_modules small.

RULES:
1. Never guess the Meta API. Read https://dev.meta.ai/docs and the cookbook for the endpoint, auth, model names and image/audio input format. If you cannot read them, STOP and ask me to paste the relevant page.
2. API keys live only in Netlify env vars and a gitignored .env. Never in browser code, never committed.
3. All AI calls go through ONE module (netlify/functions/_lib/ai.js) with model names in one config object, and AI_MODE=live|mock. In mock mode, return saved fixtures from /fixtures so I do not burn credits.
4. Every AI response the app depends on must be JSON, validated against a schema before use. On failure retry once, then show a friendly error and let the user fix things by hand.
5. Never let the AI invent data. Unreadable means null plus a flag. A human confirms before anything is saved.
6. No AI-written message is ever sent to a customer. Default messages are pre-written templates. The owner sends everything themselves.
7. All test and demo data is fake. Never commit real customer data or real photos.
8. Design: mobile first, big tap targets, tablet friendly, calm and readable, simple. Not an "AI look": no purple gradients, no emoji headings.
9. After each stage: list the files changed, how to run it, how I should test it, then STOP. Commit with a clear message. Do not start the next stage.
10. Ask before making big decisions. Prefer the simplest thing that works.
