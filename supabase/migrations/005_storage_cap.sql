-- PandaInk — authoritative server-side enforcement of the free-plan drawing cap.
-- Run this in the Supabase SQL editor after 001-004.
--
-- supabase_store.js already blocks the 11th drawing client-side (MAX_DRAWINGS),
-- but that's just UX -- a modified or bypassed client could upload past the cap
-- directly against the Storage API. This trigger makes the limit real: any
-- INSERT into the 'drawings' bucket by a user whose profiles.plan is 'free'
-- is rejected once they already have 10 objects in their <user_id>/ folder.
-- Pro users are unaffected (no cap). Overwriting an existing drawing (same
-- object name, e.g. an upsert) never counts against the cap.

create or replace function public.enforce_drawing_cap()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  owner_id       uuid;
  user_plan      text;
  existing_count int;
  max_drawings   constant int := 10;  -- must match MAX_DRAWINGS in supabase_store.js
begin
  if new.bucket_id != 'drawings' then
    return new;
  end if;

  owner_id := (storage.foldername(new.name))[1]::uuid;

  select plan into user_plan from public.profiles where id = owner_id;
  if user_plan is distinct from 'free' then
    return new;  -- pro (or missing profile) — no cap
  end if;

  select count(*) into existing_count
  from storage.objects
  where bucket_id = 'drawings'
    and (storage.foldername(name))[1] = owner_id::text
    and name != new.name;  -- an overwrite of the same object is not a new drawing

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
