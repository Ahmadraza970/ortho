-- Ortho — schema (Supabase Postgres)
-- Har table par RLS ON; har user sirf apni rows dekh/bad/mita sakta hai.

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  sleep text check (sleep in ('achhi','beech','kharab')),
  nose int check (nose between 0 and 10),
  headache int check (headache between 0 and 10),
  study_impact text check (study_impact in ('koi_nahi','thoda','zyada')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  medicine_name text,
  medicine_timing text,
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  detail text,
  place text,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.checkins enable row level security;
alter table public.profiles enable row level security;
alter table public.doctors enable row level security;
alter table public.push_subscriptions enable row level security;

-- Policies: TO authenticated + ownership check ((select auth.uid()) = user_id)
do $$
declare t text;
begin
  foreach t in array array['checkins','profiles','doctors','push_subscriptions'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Data API grants (authenticated role ko table access; RLS rows control karta hai)
grant select, insert, update, delete on public.checkins, public.profiles, public.doctors, public.push_subscriptions to authenticated;
