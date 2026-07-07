-- Fixes saveDevice()'s upsert({ onConflict: 'user_id' }) in auth_manager.js,
-- which requires a unique constraint on user_id to resolve conflicts against.
alter table public.devices
  add constraint devices_user_id_key unique (user_id);
