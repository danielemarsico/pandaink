# PandaInk — Remaining Tasks

---

## Manual Actions — Daniele (Admin)

The web-app auth / tiered-storage / Cloudflare-Worker / live-sharing **code is implemented**.
These steps need external dashboards and accounts and can only be done by the project owner.
Do them at your own pace; each is independent unless noted.

### Supabase
- [ ] **URGENT — re-run `005_storage_cap.sql`** in the Supabase SQL editor. The version already
      live in production has a bug (`42702 ambiguous_column` — a local variable named `owner_id`
      collided with `storage.objects`'s own `owner_id` column) that currently rejects **every**
      cloud upload for free-plan users, not just the 11th. Fixed in the migration file (renamed
      to `v_owner_id`); `CREATE OR REPLACE FUNCTION` safely overwrites the broken one in place.
- [ ] **Submit the Google OAuth consent screen for verification** — required to remove the
      "unverified app" warning users see when connecting Google Drive (the app requests the
      sensitive `drive.appdata` scope). Not required for Google/GitHub sign-in itself — those
      only use non-sensitive scopes and are unaffected by this. Steps:
      1. Go to **Google Cloud Console → APIs & Services → OAuth consent screen** (project "PandaInk").
      2. Confirm branding is complete: app name, logo, support email, developer contact email,
         **Application home page** (e.g. `https://danielemarsico.github.io/pandaink/`), and
         **Application privacy policy link** — use `https://danielemarsico.github.io/pandaink/privacy.html`
         (already live, see `docs/privacy.html`).
      3. Under **Authorized domains**, make sure `github.io` (or your custom domain) is listed;
         if prompted, verify domain ownership via Google Search Console.
      4. On the **Scopes** step, confirm `.../auth/drive.appdata` is listed as a requested
         sensitive scope.
      5. Click **"Prepare for verification"** / **"Submit for verification"** on the consent
         screen page. Google's form will ask for:
         - A written **justification** for `drive.appdata` — explain it's used only to store
           each user's own drawing backups in their private, app-only Drive folder; the app
           never reads/shares data from elsewhere in the user's Drive.
         - A **demo video** (screen recording, no special editing needed): show signing into
           PandaInk, opening Profile → Cloud Storage → "Connect Google Drive", completing the
           Google consent screen, and a drawing being saved/restored afterward.
      6. Submit and wait — typically a few days up to ~2 weeks. Google may email follow-up
         questions; respond via the same consent-screen verification form.
      7. Until approved, Drive-connect still works, but users see an "unverified app" warning
         and must click **Advanced → Go to PandaInk (unsafe)** to proceed — mention this to
         early testers so they aren't alarmed.

### Ko-fi (Pro = one-time $5)
- [ ] **Send a Ko-fi test webhook** (or do a real $5 purchase) and confirm the Worker grants
      `profiles.plan = 'pro'` for the matching Supabase account — not yet verified end-to-end.

### Dropbox (paid provider)
- [ ] **Create a Dropbox app** (App Console → Scoped access → App folder), permissions
      `files.content.write/read`, `files.metadata.read`; add redirect URI
      `https://danielemarsico.github.io/pandaink/app.html`. Copy the **App key** into
      `docs/config.js` → `DROPBOX_CLIENT_ID`.

> Once `DROPBOX_CLIENT_ID` is set, everything below in "Blocked" becomes testable.

---

## Blocked — Complete After Daniele's Manual Actions

These need the admin steps above finished first. Grouped by which admin action unblocks them.

**After migration `005_storage_cap.sql` is run:**
- [ ] Verify the trigger actually rejects an 11th drawing for a free-plan user uploaded
      *directly* against the Storage REST API (bypassing `supabase_store.js`'s client-side
      check) — confirms the cap is real, not just a UX nicety.

**After `DROPBOX_CLIENT_ID` is set (and a Pro account):**
- [ ] Connect Dropbox, sync a drawing, confirm `drawing_<ts>.json` lands in the app folder and
      re-appears after reload / on another browser (reconciliation).

**After the Worker is deployed + `WORKER_BASE_URL` set:**
- [ ] Google Drive connect now works without any secret in the frontend (token exchange via
      Worker); sync + reconcile round-trips.
- [ ] "Delete account" removes the auth user (profile/devices/tokens cascade) and logs out.
- [ ] Live sharing: enable "Share this session", open the `?watch=` link in a second signed-in
      browser, confirm strokes mirror in real time.

**After the Ko-fi Shop item + webhook are configured:**
- [ ] Buy the $5 Pro item with the account email → `profiles.plan` flips to `pro` → Drive &
      Dropbox unlock in the picker. Verify a mismatched email is handled (manual reconcile).

**Hardware (needs the Bamboo Folio):**
- [ ] Full device sync → each drawing gets a ☁↑ badge with no cloud, flips to ☁✓ once a
      provider is connected.

---

## Windows App

### Manual / User Steps

- [ ] **Screenshots** — Replace grey placeholder boxes in `docs/features.html` with real screenshots once app is stable
- [ ] **GitHub Sponsors** — Enrol at github.com/sponsors; once approved, uncomment `github: danielemarsico` in `.github/FUNDING.yml`
- [ ] **Lightning donations** — Create a Lightning Address (e.g. via Wallet of Satoshi or Alby) and add donate links to `docs/index.html` and `docs/download.html`

### Hardware Smoke-Tests (need real Bamboo Folio F4:21:DE:4D:26:BF)

- [ ] **GUI Live mode** — Start Live → draw → strokes appear in real time → Stop Live → drawing saved as new tab

### Research (no implementation)

- [ ] **S2-3 Stroke segmentation in live mode** — Decide how to detect when a stroke is finished in the browser. Options: pen-left-proximity event (0xff×6 packet, already handled, most reliable), pressure-drop timeout (~200 ms fallback), velocity/direction heuristic (complex). Recommendation: rely on existing proximity event as primary; add 200 ms pressure-drop timeout as fallback for devices that don't reliably send 0xff packets.

---

## Web App

### BLE Protocol — Critical Fixes (blocker for Folio sync)

Found by diffing `docs/ble/sync.js` against the working Python reference
(`src/tuhi/protocol.py`, `src/tuhi/wacom_win.py`). The Bamboo Folio speaks the
**Slate** protocol; both bugs are in Slate-specific behavior, so sync will fail on
real hardware even now that the BLE-layer (GATT/notify) bugs are fixed. Both fixes
below are implemented and verified against the Python reference offline — only the
hardware smoke-tests remain.

- [ ] **C1 hardware test** (end-of-download detection for Slate/Folio, `sync.js`
      `readOfflinePenData()`) — sync 1 drawing, sync several drawings in one session,
      sync with 0 drawings on device.
- [ ] **C2 hardware test** (Slate stroke-file parser, `sync.js` `parseStrokeData()`) —
      sync a real Folio drawing and visually compare against the same drawing synced by
      the Python GUI (stroke count, shape, no corner spikes at 65535).
- [ ] **Follow-ups from the same audit (non-blocking)**
  - [ ] Port `register_device_finish()` (Slate: set time, transfer-GATT select, name,
        dimensions, firmware, battery) into the web registration flow

### Cloud Storage (rules in RULEBOOK.md → "Web App — Cloud Storage")

Tiered model (RULEBOOK.md → "Web App — Cloud Storage"): Supabase Storage = free
(max 10 drawings); Google Drive + Dropbox = paid (`profiles.plan = 'pro'`). Gating is an
entitlement flag; Pro is a one-time $5 Ko-fi purchase. **Code is now implemented** — the
remaining unchecked items are Daniele's admin setup (see "Manual Actions") and end-to-end
testing (see "Blocked on Daniele's manual actions").

- [ ] **S1 hardware test** (local IndexedDB store + loss protection) — sync with no cloud
      → drawings appear and persist across reload; then connect Drive → pending drawings upload.
- [ ] Follow-up: lazy "cloud-only, not cached" (☁↓) state — reconciliation caches eagerly now.
- [ ] Follow-up (decide with user): migration-on-switch between providers.

### Authentication — finish (rules in RULEBOOK.md → "Feature Tracking")

- [ ] **GitHub OAuth App** — admin task, see "Manual Actions".

### Live-session sharing (frontend)

- [ ] Test end-to-end once the Worker is deployed (see "Blocked on Daniele's manual actions").

### Phase 5 — Polish

- [ ] **Submit for Google verification** — see detailed steps under "Manual Actions — Daniele (Admin) → Supabase" near the top of this file.
