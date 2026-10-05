-- Local development and tests only (never run this on Supabase): a tiny
-- stand-in for Supabase's auth schema so the app runs without Supabase.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  email_confirmed_at timestamptz,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

-- One-time links (confirm email, reset password, change email).
create table if not exists auth.local_otps (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  new_email text,
  expires_at timestamptz not null,
  used_at timestamptz
);
