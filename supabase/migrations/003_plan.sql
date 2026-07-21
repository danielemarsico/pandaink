-- PandaInk — add the free/paid entitlement flag and widen storage_provider.
-- Run this in the Supabase SQL editor (or via supabase db push) after 001/002.

-- plan: 'free' (Supabase Storage only, 10-drawing cap) | 'pro' (Drive + Dropbox)
alter table public.profiles
  add column if not exists plan text not null default 'free';

alter table public.profiles
  drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check check (plan in ('free', 'pro'));

-- storage_provider now spans all three providers (plus null = none chosen yet).
--   'supabase' | 'google_drive' | 'dropbox' | null
comment on column public.profiles.storage_provider is
  '''supabase'' | ''google_drive'' | ''dropbox'' | null';

-- The Pro unlock is performed by the Cloudflare Worker (Ko-fi webhook) using the
-- service-role key, which bypasses RLS — so no extra policy is needed here. Users
-- can READ their own plan via the existing "profiles: owner access" policy, but
-- must not be able to grant themselves Pro. Tighten the owner policy so users can
-- update their own row WITHOUT changing plan (plan changes require service-role).
drop policy if exists "profiles: owner access" on public.profiles;

create policy "profiles: owner read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: owner insert"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Update allowed only when the plan is left unchanged (compares to the stored row).
create policy "profiles: owner update (no self-upgrade)"
  on public.profiles for update
  using  (auth.uid() = id)
  with check (auth.uid() = id and plan = (select p.plan from public.profiles p where p.id = auth.uid()));
