# Connect your real project — exact steps

Do this **once, near the end** (before recording the demo video or deploying).
Everything works in demo mode until then, so nothing is blocked.

These steps use the Supabase website exactly as it looks in 2026. You do not
need to install anything or type any commands. You have done step 0 partly
already (a project exists), so start at step 1.

---

## Step 0 — First, make the old secret key useless (2 minutes)

You once copied a **secret key** (`sb_secret_…`) into this chat. That key is
dangerous if anyone sees it. Fix it now:

1. Go to https://supabase.com/dashboard and open your project.
2. Left sidebar, very top: click the **gear icon** (Project Settings).
3. Click **API Keys** in the settings list.
4. Find the row that says **Secret keys**. Next to the old key there are three
   buttons at the right: **Reveal / Copy / Revoke** (in a small `⋯` menu if
   you do not see the word). Click **Revoke**.
5. It asks you to confirm. Confirm. The old key now does nothing. Done — that
   leaked key can never be used again.

After revoking, Supabase may show a "Create new secret key" button.
**You do not need a secret key. Ignore it.** This project only uses the two
safe keys below.

---

## Step 1 — Copy the two safe values (1 minute)

On that same **API Keys** page:

1. Find **Project URL** at the top (looks like
   `https://abcdefghij.supabase.co`). Click its **Copy** button.
   → Paste it somewhere safe for a minute (Notepad).

2. Find the key labeled **Publishable key** (starts with `sb_publishable_…`).
   Click its **Copy** button. → Paste it in the same Notepad.

That is all you copy. **Never** use or send any key starting with
`sb_secret_` — you will not need one at all.

> Why these are safe: the URL and publishable key are meant to sit inside
> websites. The database rules you install in step 2 make it impossible for
> strangers to see their data.

---

## Step 2 — Install the database rules (3 minutes)

1. Open a new tab and open this repo folder
   (`pagebook`), then open the file `supabase/schema.sql` in Notepad.
   Select **all** of it (Ctrl+A) and copy it (Ctrl+C).
2. Back in the Supabase dashboard: left sidebar, click the **SQL editor**
   icon (it looks like a terminal prompt `>_`, label "SQL Editor").
3. Click **New query** (top left of the editor).
4. Click into the big empty box and paste (Ctrl+V).
5. Click **Run** (bottom right, or Ctrl+Enter).
6. You should see **"Success"** in a green line at the bottom. (If it says
   "No rows returned", that is also fine.)

What you just installed:

- 3 tables: `people`, `pages`, `page_rows`
- Rules that make every saved page **private to the account that saved it**
- The private storage bucket `page-photos` for page photographs

---

## Step 3 — Let demo sign-ups work instantly (2 minutes, optional but recommended)

By default Supabase asks people to click a link in their email before the
account works. For your own demonstration that extra step is friction:

1. Left sidebar: click the **Authentication** icon (a shield, label
   "Authentication").
2. In its settings click **Sign In / Providers** (or "Providers").
3. Click **Email** to expand it.
4. **Turn OFF** the switch **Confirm email**.
5. Scroll down and click **Save**.

Now accounts activate immediately — better for the recorded demo.
(Remember to turn it back ON after the hackathon.)

---

## Step 4 — Put the two values into the app (2 minutes)

1. Open the folder `pagebook` in Windows Explorer.
2. Open the file called **`.env`** in Notepad (if you cannot see it, turn on
   View → Show → Hidden items; the file exists — it is just hidden by rule).
3. Two lines in it start with `SUPABASE_URL=` and `SUPABASE_PUBLISHABLE=`.
   Make them look like this, using **your** copied values (no quotes, no
   spaces around `=`):

   ```
   SUPABASE_URL=https://abcdefghij.supabase.co
   SUPABASE_PUBLISHABLE=sb_publishable_xxxxxxxxxxxxxxxxxxxx
   ```

4. Save and close Notepad.

5. Close the black app window (the one from **Start Page Ledger.bat**) and
   double-click **Start Page Ledger.bat** again. ⚠️ The app only reads these
   values when it starts.

---

## Step 5 — Prove it worked (3 minutes)

Open the app at http://localhost:8888 and check, in order:

1. Top of the home page: the demo-mode note about "this device only" is
   **gone**.
2. **Create an account** with any email + password — no confirmation email
   needed; you land signed-in in the app.
3. Try the sample page → check the rows → **Save this page** → the status says
   the page and photo are in your account (not "on this device").
4. **Recent pages** shows the page you just saved.
5. Click your email chip → **Sign out** → sign back in with the same email →
   the saved page is **still there** (it was really in the cloud).

If any step fails, check step 4 for typos first; that solves 9 of 10 cases.

---

## Later — when the site goes public (deploy stage)

At deployment (Netlify) the same two values go into **Site configuration →
Environment variables** as `SUPABASE_URL` and `SUPABASE_PUBLISHABLE`.
That is a later stage; this guide stays here when you need it.

## Checklist

- [ ] 0. Old secret key **revoked**
- [ ] 1. Copied Project URL + Publishable key (no secret key, ever)
- [ ] 2. `schema.sql` run with Success
- [ ] 3. Confirm email OFF (demo convenience; back ON after the hackathon)
- [ ] 4. `.env` filled, app restarted
- [ ] 5. Sign-up → save → recent → sign out/in → data persists
