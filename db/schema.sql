-- QR Review database tables.
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again; it only creates what is missing.

-- One row per business owner. The id is their Supabase login (auth.users).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  is_admin boolean not null default false,
  disabled_at timestamptz,
  trial_ends_at timestamptz not null,
  -- trialing | active | past_due | canceled | unpaid | incomplete ... (Stripe's words)
  subscription_status text not null default 'trialing',
  plan_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique
);

create table if not exists public.businesses (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null,
  logo_file text,
  brand_colour text not null default '#0f766e',
  google_review_url text not null,
  -- Permanent: printed on cards and vans, so it must never change.
  qr_slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Visits to the public review page. No customer personal data: the visitor
-- hash is salted per day so it can't follow anyone across days.
create table if not exists public.qr_visits (
  id bigint generated always as identity primary key,
  business_id bigint not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 'view' = review page opened; 'google' = tapped through to Google
  event text not null default 'view' check (event in ('view', 'google')),
  -- 'qr' (scanned/opened directly), 'link' (shared link), later 'nfc', 'van'...
  source text,
  visitor_hash text
);
create index if not exists qr_visits_business_time on public.qr_visits (business_id, created_at);

-- Stripe can send the same event twice; we remember which ones we handled.
create table if not exists public.stripe_events (
  id text primary key,
  received_at timestamptz not null default now()
);

-- Lock the tables. Supabase can expose tables to browsers through its API;
-- with row level security on and no policies, nobody can read or write them
-- that way. Only the app's server (which connects as the database owner)
-- can use them.
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.qr_visits enable row level security;
alter table public.stripe_events enable row level security;
