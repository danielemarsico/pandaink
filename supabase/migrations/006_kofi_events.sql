-- PandaInk — replay/forgery protection for the Ko-fi Pro-unlock webhook.
-- Run this in the Supabase SQL editor after 001-005.
--
-- The Worker's /kofi/webhook only checks a static shared secret
-- (KOFI_VERIFICATION_TOKEN), not a per-request signature. Recording each
-- processed Ko-fi transaction id here lets the Worker reject a webhook it has
-- already handled -- whether that's Ko-fi's own retry, someone replaying a
-- captured request, or a forged request built from a leaked token but reusing
-- an old transaction id. Only the Worker (service-role key) ever touches this
-- table, so RLS is enabled with no policies -- deny all client access.

create table if not exists public.kofi_events (
  kofi_transaction_id text primary key,
  email                text,
  processed_at         timestamptz default now()
);

alter table public.kofi_events enable row level security;
-- No policies: only the service-role key (which bypasses RLS) can read/write.
