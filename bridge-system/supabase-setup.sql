-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  Bridge System Editor — Supabase database setup
--  Run this entire file in the Supabase SQL Editor once.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


-- ── 1. profiles ─────────────────────────────────────────────────────────────
-- Mirrors auth.users with a public-facing email / display name / avatar.

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  updated_at   timestamptz default now()
);

alter table public.profiles enable row level security;

-- Profiles are readable by any authenticated user (needed for collab lookup)
create policy "profiles: authenticated read"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Users can only update their own profile
create policy "profiles: owner update"
  on public.profiles for update
  using (auth.uid() = id);

-- Automatically create a profile row whenever a new user signs in via GitHub
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'preferred_username',
             new.raw_user_meta_data->>'name',
             new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email        = excluded.email,
    display_name = excluded.display_name,
    avatar_url   = excluded.avatar_url,
    updated_at   = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();


-- ── 2. systems ───────────────────────────────────────────────────────────────

create table if not exists public.systems (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  data        jsonb not null default '{}',
  visibility  text not null default 'private' check (visibility in ('private','shared','public')),
  slug        text unique,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.systems enable row level security;

-- Owner can do everything
create policy "systems: owner all"
  on public.systems for all
  using  (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Anyone (including anonymous) can read public systems
create policy "systems: public read"
  on public.systems for select
  using (visibility = 'public');

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists systems_updated_at on public.systems;
create trigger systems_updated_at
  before update on public.systems
  for each row execute procedure public.set_updated_at();


-- ── 3. collaborators ─────────────────────────────────────────────────────────

create table if not exists public.collaborators (
  system_id  uuid not null references public.systems(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('editor','viewer')),
  added_at   timestamptz default now(),
  primary key (system_id, user_id)
);

alter table public.collaborators enable row level security;

-- System owner manages collaborators
create policy "collaborators: owner all"
  on public.collaborators for all
  using (
    exists (
      select 1 from public.systems s
      where s.id = system_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.systems s
      where s.id = system_id and s.owner_id = auth.uid()
    )
  );

-- Collaborators can see the row for their own entry (to confirm they have access)
create policy "collaborators: self select"
  on public.collaborators for select
  using (user_id = auth.uid());

-- ── Back-fill systems policies that depend on collaborators ──────────────────
-- These are defined here (after the collaborators table exists) to avoid the
-- "relation does not exist" error that occurs if they are placed earlier.
--
-- IMPORTANT: we use security definer helper functions to break the circular
-- RLS dependency:  systems policy → queries collaborators → collaborators policy
-- → queries systems → … (infinite recursion).
-- A security definer function runs as its owner (bypassing RLS), so the chain
-- is cut at exactly one level.

create or replace function public.is_collaborator(sys_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.collaborators
    where system_id = sys_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_collaborator_editor(sys_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.collaborators
    where system_id = sys_id and user_id = auth.uid() and role = 'editor'
  );
$$;

create or replace function public.is_system_owner(sys_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.systems
    where id = sys_id and owner_id = auth.uid()
  );
$$;

-- Drop and re-create the two collaborator-referencing systems policies
drop policy if exists "systems: collaborator select" on public.systems;
drop policy if exists "systems: collaborator update" on public.systems;

create policy "systems: collaborator select"
  on public.systems for select
  using (public.is_collaborator(id));

create policy "systems: collaborator update"
  on public.systems for update
  using (public.is_collaborator_editor(id));

-- Drop and re-create the collaborators owner policy (also used is_system_owner)
drop policy if exists "collaborators: owner all" on public.collaborators;

create policy "collaborators: owner all"
  on public.collaborators for all
  using  (public.is_system_owner(system_id))
  with check (public.is_system_owner(system_id));


-- ── 4. find_user_by_email RPC ─────────────────────────────────────────────────
-- Used by the Share modal to look up a user by email address.
-- Returns only the id + display_name + avatar (not the raw auth row).

create or replace function public.find_user_by_email(search_email text)
returns table (id uuid, display_name text, avatar_url text, email text)
language plpgsql security definer as $$
begin
  return query
    select p.id, p.display_name, p.avatar_url, p.email
    from public.profiles p
    where lower(p.email) = lower(search_email)
    limit 1;
end;
$$;

-- Grant execute to authenticated users only
revoke execute on function public.find_user_by_email(text) from public;
grant  execute on function public.find_user_by_email(text) to authenticated;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  Done!  Next steps are in SETUP.md.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
