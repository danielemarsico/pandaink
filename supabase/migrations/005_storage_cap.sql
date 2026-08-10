-- PandaInk — authoritative server-side enforcement of the free-plan drawing cap.
-- Run this in the Supabase SQL editor after 001-004.
--
-- supabase_store.js already blocks the 11th drawing client-side (MAX_DRAWINGS),
-- but that's just UX -- a modified or bypassed client could upload past the cap
-- directly against the Storage API. This trigger makes the limit real: any
-- INSERT into the 'drawings' bucket by a user whose profiles.plan is 'free'
-- is rejected once they already have 10 objects in their <user_id>/ folder.
-- Only an explicit profiles.plan = 'pro' lifts the cap. Overwriting an existing
-- drawing (same object name, e.g. an upsert) never counts against the cap.
--
-- This file is idempotent (CREATE OR REPLACE + DROP/CREATE TRIGGER) — re-running
-- it in the SQL editor safely replaces whatever version is live.

create or replace function public.enforce_drawing_cap()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  -- Prefixed with v_ to avoid colliding with storage.objects' own "owner_id"
  -- column -- an unprefixed `owner_id` local variable is ambiguous against
  -- that column under Postgres's default plpgsql.variable_conflict = error,
  -- and every insert fails with "42702 column reference is ambiguous".
  v_owner_id     uuid;
  user_plan      text;
  existing_count int;
  max_drawings   constant int := 10;  -- must match MAX_DRAWINGS in supabase_store.js
begin
  if new.bucket_id != 'drawings' then
    return new;
  end if;

  v_owner_id := (storage.foldername(new.name))[1]::uuid;

  select plan into user_plan from public.profiles where id = v_owner_id;
  -- A missing profiles row must NOT mean "uncapped": treat anything that isn't
  -- an explicit 'pro' as free. (The previous `is distinct from 'free'` test let
  -- a user with no profile row -- user_plan null -- upload without any limit.)
  if coalesce(user_plan, 'free') = 'pro' then
    return new;  -- pro — no cap
  end if;

  select count(*) into existing_count
  from storage.objects
  where bucket_id = 'drawings'
    and (storage.foldername(name))[1] = v_owner_id::text
    and name like '%.json'  -- count drawings only, same as supabase_store.js
    and name != new.name;   -- an overwrite of the same object is not a new drawing

  if existing_count >= max_drawings then
    raise exception 'Free plan is limited to % drawings. Delete an old drawing or upgrade to Pro.', max_drawings
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_drawing_cap on storage.objects;
create trigger enforce_drawing_cap
  before insert on storage.objects
  for each row execute procedure public.enforce_drawing_cap();
