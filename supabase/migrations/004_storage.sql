-- PandaInk — Supabase Storage bucket for the free-tier drawing store.
-- Run this in the Supabase SQL editor after 003.
--
-- Layout: private bucket 'drawings', one object per drawing at
--   <user_id>/<timestamp>.json
-- Owner-only access is enforced by matching the first path segment to auth.uid().
-- The 10-drawing cap is enforced in the app (and authoritatively in the Worker);
-- Storage RLS only scopes access to the user's own folder.

insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', false)
on conflict (id) do nothing;

-- Users can read/write/delete only objects under their own <user_id>/ prefix.
drop policy if exists "drawings: owner read"   on storage.objects;
drop policy if exists "drawings: owner insert" on storage.objects;
drop policy if exists "drawings: owner update" on storage.objects;
drop policy if exists "drawings: owner delete" on storage.objects;

create policy "drawings: owner read"
  on storage.objects for select
  using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "drawings: owner insert"
  on storage.objects for insert
  with check (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "drawings: owner update"
  on storage.objects for update
  using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "drawings: owner delete"
  on storage.objects for delete
  using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);
