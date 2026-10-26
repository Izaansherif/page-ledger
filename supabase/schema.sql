-- ============================================================================
-- Page Ledger - Stage 2 core schema (paste into Supabase SQL Editor > Run)
-- Ownership model: every table is owned by auth.users; Row Level Security
-- allows a user to touch ONLY their own rows. No service key needed by the app.
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- customers
create table public.people (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  phone       text,
  note        text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- pages
-- One photo of one notebook page.
create table public.pages (
  id                  uuid primary key default gen_random_uuid(),
  owner               uuid not null references auth.users (id) on delete cascade,
  photo_path          text not null,          -- path inside storage bucket "page-photos"
  taken_on            date,                   -- base date used while reading
  page_total_written  numeric(12, 2),
  page_warnings       jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

-- --------------------------------------------------------------------- rows
-- Each line the AI read (as the owner confirmed/edited it).
create table public.page_rows (
  id                  uuid primary key default gen_random_uuid(),
  page_id             uuid not null references public.pages (id) on delete cascade,
  owner               uuid not null references auth.users (id) on delete cascade,
  person_id           uuid references public.people (id) on delete set null,
  name                text not null default '',   -- name as written on the page
  phone               text,
  note                text,
  amount_paid         numeric(12, 2),
  amount_due          numeric(12, 2),
  follow_up_text      text,                       -- e.g. "after 2 weeks"
  follow_up_date      date,
  follow_up_confirmed boolean not null default false,
  struck_out          boolean not null default false,
  included            boolean not null default true,
  row_index           integer not null default 0,
  raw_text            text,
  confidence          jsonb not null default '{}'::jsonb,
  flags               jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create index pages_owner_idx   on public.pages    (owner, created_at desc);
create index rows_page_idx     on public.page_rows (page_id);
create index rows_owner_idx    on public.page_rows (owner, created_at desc);
create index people_owner_idx  on public.people   (owner, name);

-- ------------------------------------------------------- Row Level Security
alter table public.people    enable row level security;
alter table public.pages     enable row level security;
alter table public.page_rows enable row level security;

create policy "people_own"   on public.people   for all
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy "pages_own"    on public.pages    for all
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy "rows_own"     on public.page_rows for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- --------------------------------------------------------- private bucket
insert into storage.buckets (id, name, public)
values ('page-photos', 'page-photos', false)
on conflict (id) do nothing;

-- photos live under a folder named <uid>/ per user; only that user may use them
create policy "photos_own" on storage.objects for all to authenticated
  using ((storage.foldername(name))[1] = auth.uid()::text)
  with check ((storage.foldername(name))[1] = auth.uid()::text);
