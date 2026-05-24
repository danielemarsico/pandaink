-- PandaInk — initial schema
-- Run this in the Supabase SQL editor (or via supabase db push).

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles: one row per auth.users entry, auto-created via trigger
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text,
  storage_provider text default null,  -- 'google_drive' | null
  created_at       timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner access"
  on public.profiles for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ─────────────────────────────────────────────────────────────────────────────
-- devices: Wacom device registration per user
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  wacom_uuid  text not null,      -- 6-byte hex string used in BLE protocol
  protocol    smallint not null,  -- 1=Spark  2=Slate  3=IntuosPro
  device_name text,
  updated_at  timestamptz default now()
);

alter table public.devices enable row level security;

create policy "devices: owner access"
  on public.devices for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- storage_tokens: OAuth tokens for connected cloud storage providers
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.storage_tokens (
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null,         -- 'google_drive'
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  primary key (user_id, provider)
);

alter table public.storage_tokens enable row level security;

create policy "storage_tokens: owner access"
  on public.storage_tokens for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
