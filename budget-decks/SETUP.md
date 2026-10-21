# Budget Decks — one-time setup

Uses the same Supabase project as `bridge-system` (`nltiszypgoidzsgsqjdi`), so
Google/GitHub sign-in and the `profiles` table are already there.

## 1. Database

Supabase Dashboard → SQL Editor → paste and run [`mtg-setup.sql`](mtg-setup.sql).
It's safe to re-run.

## 2. Edge function

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:

```bash
supabase login
supabase functions deploy mtg-submit --no-verify-jwt --project-ref nltiszypgoidzsgsqjdi
```

`--no-verify-jwt` is deliberate: anyone may run a "Check only", and the function
checks the user's token itself before saving. No secrets are needed.

## 3. Auth redirect

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, add:

- `https://mjj29.github.io/ai-applications/budget-decks/`
- `http://localhost:7433/` (local testing)

Leave the Site URL as it is (bridge-system).

## 4. First admin

Sign in on the site once, then in the SQL Editor:

```sql
insert into public.mtg_admins (user_id)
select id from auth.users where email = 'you@example.com';
```

Further admins can be added from the Admin panel on the site (they must have
signed in once).

## 5. Publish

Commit and push: GitHub Pages serves the repo root, so the app appears at
https://mjj29.github.io/ai-applications/budget-decks/.

## Local run

```bash
python -m http.server 7433 --directory budget-decks
```

`test/deck-test.html?link=<share link>` prices a link in the browser with the
same code the edge function uses, without touching the database.
