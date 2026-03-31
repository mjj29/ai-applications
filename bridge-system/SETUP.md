# Bridge System Editor — Cloud Setup Guide

> One-time setup to connect the app to Supabase and GitHub OAuth.

---

## 1. Run the database SQL

1. Open your Supabase project → **SQL Editor**
2. Create a new query, paste the entire contents of **`supabase-setup.sql`**, and click **Run**
3. You should see "Success. No rows returned" — no errors

This creates:

| Object | Purpose |
|---|---|
| `profiles` table | Stores display name, avatar, email for every user |
| `systems` table | Stores bridge systems (JSONB `data` field + visibility/slug) |
| `collaborators` table | Maps users to systems with a role (editor / viewer) |
| `handle_new_user` trigger | Auto-creates a profile row on first GitHub sign-in |
| `find_user_by_email` RPC | Lets the Share modal look up a user by email |

---

## 2. Enable GitHub OAuth in Supabase

### Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name:** Bridge System Editor (or anything)
   - **Homepage URL:** `https://mjj29.github.io/ai-applications/bridge-system/`
   - **Authorization callback URL:**
     ```
     https://<YOUR_PROJECT_ID>.supabase.co/auth/v1/callback
     ```
     (Find your project ID in Supabase: **Project Settings → General → Reference ID**)
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret** — keep these

### Configure Supabase

1. Supabase → **Authentication → Providers → GitHub**
2. Toggle it **on**
3. Paste the **Client ID** and **Client Secret** from GitHub
4. Save

### Add redirect URL allowlist

1. Supabase → **Authentication → URL Configuration**
2. **Site URL:** `https://mjj29.github.io/ai-applications/bridge-system/`
3. **Redirect URLs** → add:
   ```
   https://mjj29.github.io/ai-applications/bridge-system/
   http://localhost:7432/
   ```
4. Save

---

## 3. Fill in `js/config.js`

Open `js/config.js` and replace the placeholders:

```javascript
export const SUPABASE_URL      = 'https://abcdefghij.supabase.co';   // Project Settings → API → URL
export const SUPABASE_ANON_KEY = 'sb_publishable_...';               // Project Settings → API → Publishable key
export const SITE_URL = 'https://mjj29.github.io/ai-applications/bridge-system/';
```

- **SUPABASE_URL** — Supabase → Project Settings → API → "Project URL"
- **SUPABASE_ANON_KEY** — Supabase → Project Settings → API → "Publishable key" (previously labelled `anon public`)

> ⚠️ The anon key is public and safe to commit — it is rate-limited by Row Level Security policies.

---

## 4. Deploy to GitHub Pages

```bash
# From your repo root
git add bridge-system/
git commit -m "Add Supabase cloud backend"
git push
```

GitHub Pages will pick up the changes automatically.

---

## 5. Test locally

```bash
cd bridge-system
python3 -m http.server 7432
# Open http://localhost:7432/
```

Click **Sign in with GitHub** — you'll be redirected to GitHub, authorise, and land back
on the app with your avatar shown in the top-right corner.

---

## How sharing works

| Action | How |
|---|---|
| **Private system** | Stored in your account, only you see it |
| **Share with collaborator** | Open Systems list → Share button → enter their email |
| **Make public** | Share modal → "Make Public" → copy the `?s=<slug>` link |
| **Clone** | Open a public link, click "Clone to my account" |
| **Offline / not logged in** | App still works with localStorage only; no cloud sync |

---

## Row-Level Security summary

| Table | Who can read | Who can write |
|---|---|---|
| `profiles` | Any authenticated user | Own row only |
| `systems` | Owner + collaborators + public (if visibility='public') | Owner (full) + editor-role collaborators (update only) |
| `collaborators` | Owner of the system + the collaborator themselves | Owner of the system only |

---

## Deploying the AI proxy Edge Function

The AI chat tab calls Anthropic / Gemini via a Supabase Edge Function so that
API keys are stored as **Supabase secrets** and never committed to the repo.

### Prerequisites

```bash
npm install -g supabase    # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref nltiszypgoidzsgsqjdi
```

### Deploy the function

```bash
supabase functions deploy ai-proxy
```

### Set API key secrets

Store whichever keys you have — the proxy handles only the providers you configure:

```bash
# Anthropic (Claude)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini
supabase secrets set GEMINI_API_KEY=AIza...
```

Verify with:

```bash
supabase secrets list
```

### How it works

- Users who are **signed in** and have **no BYOK key** set in ⚙️ Settings will have
  their requests routed through `supabase/functions/ai-proxy/index.ts`.
- The Edge Function validates the user's Supabase JWT before forwarding the
  request to Anthropic / Gemini using the server-side secrets.
- Users who **do** enter their own API key in Settings bypass the proxy entirely
  and call the provider directly from the browser (BYOK).
- The proxy streams SSE responses back so the typing animation works end-to-end.

### Security notes

- The anon key (`SUPABASE_ANON_KEY` in `config.js`) is safe to commit — it can
  only access data through your Row-Level Security policies.
- The `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` secrets are **never** sent to the
  browser; they live only in the Edge Function runtime.
- The JWT check in the Edge Function ensures only authenticated users of *your*
  Supabase project can invoke it.
