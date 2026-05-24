# PandaInk Web App — Auth + Cloud Storage Plan

## Architecture

```
GitHub Pages (static frontend)
    │
    ├── Supabase ──── Auth: email+password, Google login, GitHub login
    │                 DB:   user profiles, device configs, storage tokens
    │
    └── Google Drive ── Drawings only (user's own Drive, connected in Profile Settings)
```

**Key separation:**
- **PandaInk account** = Supabase auth (email+password or social login). Independent of storage.
- **Storage provider** = chosen and connected in Profile Settings. Google Drive at launch,
  abstracted so Dropbox/OneDrive can be added later.

---

## Supabase Database Schema

```sql
-- auto-created on new user signup via trigger
profiles (
  id              uuid  primary key references auth.users,
  display_name    text,
  storage_provider text   -- 'google_drive' | null
)

-- wacom device registration, per user
devices (
  id          uuid  primary key,
  user_id     uuid  references auth.users,
  wacom_uuid  text,       -- 6-byte hex UUID used in the BLE protocol
  protocol    smallint,   -- 1=Spark  2=Slate  3=IntuosPro
  device_name text,
  updated_at  timestamptz
)

-- OAuth tokens for connected storage providers
storage_tokens (
  user_id       uuid  references auth.users,
  provider      text,             -- 'google_drive'
  access_token  text,             -- stored encrypted
  refresh_token text,
  expires_at    timestamptz,
  primary key (user_id, provider)
)
```

Row Level Security on all tables: users can only read/write their own rows.

---

## Auth UI

**Logged-out state** — full-page auth panel:
```
┌─────────────────────────────────────────────┐
│  Sign in to PandaInk                        │
│  [Email] [Password]  [Sign in]              │
│  [Sign in with Google]  [Sign in with GitHub]│
│  Don't have an account? [Register]          │
└─────────────────────────────────────────────┘
```

**Logged-in state** — toolbar (top right):
```
avatar  user@example.com  [⚙ Profile]  [Sign out]
```

---

## Profile Settings Panel

Three sections:

**Account**
- Display name (editable)
- Email / login method shown
- Change password (email accounts only)
- Delete account

**Cloud Storage**
- Not connected: `[Connect Google Drive]`
- Connected: Drive icon + Drive email + `[Disconnect]`
- Future slots: Dropbox, OneDrive

Connecting Google Drive = PKCE OAuth flow (redirect to Google, back to app.html?code=...).
Tokens saved to `storage_tokens` Supabase table.

**Device**
- Shows registered device name + protocol
- `[Forget device]` — deletes from `devices` table + all drawings from Drive

---

## Cross-Computer Reconnect Flow

1. User logs into PandaInk on new computer → Supabase session restored
2. App queries `devices` table → gets `wacom_uuid` + `protocol`
3. App queries `storage_tokens` → gets Drive tokens → can load drawings
4. Status: *"Device loaded — click Connect to reconnect over Bluetooth"*
5. User clicks Connect → BLE scan → picks device → connects using stored `wacom_uuid`

The `wacom_uuid` is the key: same UUID from any computer means the Wacom device
recognises the host without re-registering.

---

## Cloud File Layout (Google Drive appDataFolder)

```
appDataFolder/
└── drawing_<timestamp>.json   ← one file per drawing
```

Device config lives in Supabase `devices` table, not in Drive.

Per-drawing file contents:
```json
{
  "deviceId": "<supabase device id>",
  "timestamp": 1700000000,
  "dimensions": [21000, 14800],
  "strokes": [[{"x":123,"y":456,"p":32768}]]
}
```

---

## New Files

| File | Purpose |
|---|---|
| `docs/auth/supabase_client.js` | Init Supabase JS client (URL + anon key) |
| `docs/auth/auth_manager.js` | Login / register / logout / session |
| `docs/auth/storage_oauth.js` | Google Drive PKCE flow; save tokens to Supabase |
| `docs/storage/cloud_store.js` | Abstract interface: saveDevice, loadDevice, saveDrawing, loadDrawings, deleteDrawing |
| `docs/storage/gdrive_store.js` | Google Drive implementation of cloud_store.js |
| `docs/ui/profile_panel.js` | Profile settings UI (account + storage + device) |
| `supabase/migrations/001_init.sql` | Schema + RLS policies |

## Modified Files

| File | Change |
|---|---|
| `docs/ui/app_controller.js` | Auth state gate; profile panel; replace IDB calls with cloud_store.js |
| `docs/ble/register.js` | After BLE registration, save to Supabase devices table |
| `docs/app.html` | Add Supabase JS SDK via CDN |
| `docs/style.css` | Auth panel, profile panel, avatar chip styles |

`docs/storage/idb_store.js` — unused after Phase 4, can be removed.

---

## Phases

### Phase 1 — Supabase auth
Supabase project created, schema deployed. Login/register/logout with email+password
and Google/GitHub social login. Auth panel shown when logged out. Session persists.

### Phase 2 — Profile settings + Google Drive connection
Profile panel UI. Google Drive PKCE OAuth flow. Tokens saved to storage_tokens.
Connect/disconnect Drive in settings. storage_provider saved to profiles.

### Phase 3 — Device config in Supabase
After BLE registration, write to devices table. On login, read from devices and
restore _deviceInfo. Cross-computer reconnect works.

### Phase 4 — Drawings in Google Drive
syncDrawings saves to Drive. _loadStoredDrawings fetches from Drive.
deleteDrawing deletes from Drive. IDB removed from the drawings path.

---

## One-Time External Setup

1. **Supabase** — create project at supabase.com, run 001_init.sql,
   copy project URL + anon key into supabase_client.js
2. **Google Cloud** — one project for both:
   (a) "Sign in with Google" OAuth client → configured in Supabase Auth settings
   (b) Google Drive PKCE OAuth client with drive.appdata scope
3. **GitHub OAuth app** — register at github.com/settings/developers,
   paste client ID + secret into Supabase Auth settings
