-- mtg-setup.sql — tables for the Budget Decks registry.
-- Run once in Supabase Dashboard → SQL Editor, in the same project as
-- bridge-system (it reuses that project's auth users and `profiles` table).
-- Safe to re-run.
--
-- Writes to mtg_submissions only ever happen through the mtg-submit edge
-- function (service role), which re-prices every deck itself. There is no
-- insert/update policy for normal users on purpose.

-- ─── Admins ──────────────────────────────────────────────────────────────────

create table if not exists public.mtg_admins (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.mtg_admins enable row level security;

-- security definer so policies on mtg_admins itself can call it without recursion
create or replace function public.is_mtg_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.mtg_admins where user_id = auth.uid());
$$;

drop policy if exists "mtg_admins: public read"  on public.mtg_admins;
drop policy if exists "mtg_admins: admin insert" on public.mtg_admins;
drop policy if exists "mtg_admins: admin delete" on public.mtg_admins;
create policy "mtg_admins: public read"  on public.mtg_admins for select using (true);
create policy "mtg_admins: admin insert" on public.mtg_admins for insert with check (public.is_mtg_admin());
create policy "mtg_admins: admin delete" on public.mtg_admins for delete using (public.is_mtg_admin());

-- Admin list with names, for the admin panel.
create or replace function public.mtg_admin_list()
returns table (user_id uuid, display_name text, email text, added_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.user_id, p.display_name, case when public.is_mtg_admin() then p.email end, a.added_at
  from public.mtg_admins a left join public.profiles p on p.id = a.user_id
  order by a.added_at;
$$;

-- Add an admin by email (the person must have signed in once already).
create or replace function public.mtg_add_admin(admin_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_mtg_admin() then raise exception 'Only admins can add admins'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(admin_email)) limit 1;
  if uid is null then raise exception 'No user with email % has signed in yet', admin_email; end if;
  insert into public.mtg_admins (user_id) values (uid) on conflict do nothing;
  return uid;
end $$;
revoke execute on function public.mtg_add_admin(text) from public, anon;
grant  execute on function public.mtg_add_admin(text) to authenticated;

-- ─── Settings (single row) ───────────────────────────────────────────────────

create table if not exists public.mtg_settings (
  id              int primary key default 1 check (id = 1),
  budget_main     numeric(8,2) not null default 25,
  budget_side     numeric(8,2) not null default 7.5,
  format          text not null default 'modern'
                  check (format in ('standard','pioneer','modern','legacy','vintage','pauper','premodern','commander')),
  validity_months int not null default 6 check (validity_months between 1 and 120),
  min_main        int not null default 60,
  max_side        int not null default 15,
  private_by_default boolean not null default false,  -- new decks hidden until published
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users on delete set null
);
insert into public.mtg_settings (id) values (1) on conflict do nothing;
alter table public.mtg_settings enable row level security;

drop policy if exists "mtg_settings: public read"  on public.mtg_settings;
drop policy if exists "mtg_settings: admin update" on public.mtg_settings;
create policy "mtg_settings: public read"  on public.mtg_settings for select using (true);
create policy "mtg_settings: admin update" on public.mtg_settings for update
  using (public.is_mtg_admin()) with check (public.is_mtg_admin());

create or replace function public.mtg_settings_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;
drop trigger if exists mtg_settings_touch on public.mtg_settings;
create trigger mtg_settings_touch before update on public.mtg_settings
  for each row execute procedure public.mtg_settings_touch();

-- ─── Submissions ─────────────────────────────────────────────────────────────

create table if not exists public.mtg_submissions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  submitted_by   uuid references auth.users on delete set null,
  submitter_name text,
  deck_name      text,
  link           text not null,                 -- canonical builder URL (#d=…)
  deck_hash      text not null,                 -- sha256 of the sorted 75
  colors         text not null default '',      -- WUBRG subset, '' = colourless
  featured       jsonb,                         -- { name, art, uri }
  key_cards      text[] not null default '{}',
  cards          jsonb not null,                -- { main:[[qty,name,unit]], side:[…] }
  main_count     int not null,
  side_count     int not null,
  main_total     numeric(8,2),                  -- as priced at validation
  side_total     numeric(8,2),
  budget_main    numeric(8,2) not null,         -- rules it was validated under
  budget_side    numeric(8,2) not null,
  format         text not null,
  price_date     timestamptz,                   -- price-data build time used
  valid_from     date not null,
  valid_until    date not null,
  imported       boolean not null default false, -- admin import of a past approval
  notes          text,
  refreshed_at   timestamptz,                   -- last time validity was bumped
  refresh_count  int not null default 0
);
-- columns added after the first version of this script
alter table public.mtg_submissions add column if not exists refreshed_at  timestamptz;
alter table public.mtg_submissions add column if not exists refresh_count int not null default 0;
alter table public.mtg_submissions add column if not exists is_public boolean not null default true;
alter table public.mtg_settings    add column if not exists private_by_default boolean not null default false;
create index if not exists mtg_submissions_valid_until on public.mtg_submissions (valid_until desc);
create index if not exists mtg_submissions_hash        on public.mtg_submissions (deck_hash);
alter table public.mtg_submissions enable row level security;

drop policy if exists "mtg_submissions: public read"  on public.mtg_submissions;
drop policy if exists "mtg_submissions: admin delete" on public.mtg_submissions;
drop policy if exists "mtg_submissions: read visible" on public.mtg_submissions;
-- Private (unpublished) decks are visible only to their submitter and admins.
create policy "mtg_submissions: read visible" on public.mtg_submissions for select
  using (is_public or submitted_by = auth.uid() or public.is_mtg_admin());
create policy "mtg_submissions: admin delete" on public.mtg_submissions for delete using (public.is_mtg_admin());

-- Publish or hide one deck. Owners can publish their own (one-way: once public,
-- only an admin can hide it again); admins can do either to any deck.
-- (A function rather than an update policy, so nothing else on the row can be changed.)
create or replace function public.mtg_set_public(submission_id uuid, make_public boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select submitted_by into owner from public.mtg_submissions where id = submission_id;
  if not found then raise exception 'No such deck'; end if;
  if not public.is_mtg_admin() then
    if owner is distinct from auth.uid() then raise exception 'You can only publish or hide your own decks'; end if;
    if not make_public then raise exception 'Only admins can hide a published deck'; end if;
  end if;
  update public.mtg_submissions set is_public = make_public where id = submission_id;
  return make_public;
end $$;
revoke execute on function public.mtg_set_public(uuid, boolean) from public, anon;
grant  execute on function public.mtg_set_public(uuid, boolean) to authenticated;

-- Admin: publish every hidden deck (e.g. after the event). Returns how many.
create or replace function public.mtg_publish_all()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_mtg_admin() then raise exception 'Only admins can publish all decks'; end if;
  update public.mtg_submissions set is_public = true where not is_public;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mtg_publish_all() from public, anon;
grant  execute on function public.mtg_publish_all() to authenticated;

-- ─── Bootstrap ───────────────────────────────────────────────────────────────
-- After you have signed in to the site once, make yourself the first admin:
--
--   insert into public.mtg_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
