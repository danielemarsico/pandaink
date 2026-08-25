# Changelog

All notable changes to PandaInk are documented here.
Format: `## Unreleased` for pending changes; `## <version> — <date>` for releases.

---

## Unreleased

- fix: connecting from a new browser/device right after sign-in could show the same synced
  drawing twice. `mount()` loads the drawing list directly and also gets an immediate replay
  of the current session from `onAuthStateChange`, so on a fresh (empty) local store both
  paths reconciled the cloud at once — each saw the drawing as "not local yet" and both
  inserted a copy. `_loadStoredDrawings()` is now serialized so overlapping callers share one
  in-flight pass, and a self-healing cleanup collapses any duplicate local records left over
  from before this fix (or from any other repeated-add race) back down to one.
- feat: each drawing tab now has canvas view controls — zoom (buttons, mouse wheel about the
  cursor, drag to pan, double-click to reset, 0.5×–16×) and a line-width slider (0.2×–3.0×,
  remembered across sessions and applied to the live canvas too). Strokes keep their
  on-screen thickness as you zoom, so zooming in makes handwriting bigger without making the
  ink fatter, and the canvas now renders at the device pixel ratio.
- fix: strokes were rendered too thick to read dense handwriting — loops filled in. The
  default line width is now 0.6× the previous weight, adjustable with the new slider.
- fix: renaming a drawing only ever changed it on that browser. The rename now bumps the
  record's `updatedAt` clock and marks it pending, so it is re-uploaded (and retried on the
  next sync if the upload fails, instead of silently staying local forever), and other
  devices adopt the newer name when they reconcile. Cloud-only drawings pulled down on a
  second device also keep their name — the pull used to drop it.
- fix: cloud sync is now two-way. A drawing deleted in another session is removed here
  instead of lingering (and being re-uploaded, resurrecting it), and a drawing edited
  elsewhere refreshes locally, so two devices no longer end up with a mix of stale local and
  cloud copies. The destructive half is deliberately conservative: local copies are only
  removed when the provider returned a complete listing and the record was known to be in
  that same provider, so a half-read listing or a provider switch can't wipe the library.
- fix: deleting a drawing while the cloud provider is unreachable is remembered and retried
  on the next sync; until it succeeds the drawing is not pulled back down.
- fix: switching storage provider left earlier drawings behind in the old one — they are now
  queued for upload to the newly selected provider.
- fix: the cloud is re-checked when the tab regains focus (throttled to once a minute), so
  changes made on another device appear without pressing "Sync now".
- fix: the service worker served cached JS modules cache-first under a fixed cache name, so
  a returning visitor kept running the modules cached on their first visit and never received
  app fixes. Static assets now use stale-while-revalidate and the cache tag was bumped.
- fix: the free-plan 10-drawing cap could be exceeded. The server-side trigger
  (`005_storage_cap.sql`) skipped the cap entirely for any user without a `profiles` row —
  their `plan` read back as null and null was treated as Pro — so such an account could upload
  an unlimited number of drawings. It now caps unless the plan is explicitly `pro`, and counts
  only `*.json` objects so client and database agree. Deployed and verified end-to-end against
  the live Storage REST API (bypassing the client-side check entirely): an 11th direct upload
  for a free-plan account is rejected with a `P0001` database error.
- fix: uploads to Supabase Storage are serialized per tab. The cap check lists the bucket and
  then uploads; two overlapping saves (a BLE sync and a "Sync now" retry, say) could both read
  the same pre-cap count and both upload, leaving 11 drawings stored.
- fix: a cap rejection coming from the database (rather than the client pre-check) is now
  reported as the same friendly "Free plan is limited to 10 drawings" message instead of a raw
  Supabase Storage error.
- fix: merging drawings no longer deletes the cloud copies of the originals when the merged
  drawing failed to upload (e.g. the free-plan cap was reached) — that erased them from the
  cloud with no replacement. The merge status now reports the upload failure instead of
  silently claiming success.
- feat: the Profile panel shows `N / 10 drawings used` on the Supabase Storage row, highlighted
  when the free-plan limit is reached.

- feat: the web app is now an installable **Progressive Web App** (works on GitHub Pages,
  which serves over HTTPS). Adds `manifest.webmanifest`, a service worker (`docs/sw.js`), and
  192/512 + maskable icons rasterised from the favicon. The service worker caches only the
  same-origin app shell (network-first for pages, cache-first for assets) and deliberately
  leaves all cross-origin traffic — Supabase, Google Drive, Dropbox, the Worker, the CDN —
  untouched, so auth/sync are unaffected. `app.html` gains the manifest/theme/apple meta tags
  and an "Install as app" button that appears when the browser offers installation.
- feat: add a Contact page (`docs/contact.html`) with a runtime-assembled (base64-decoded)
  email address so it isn't scrapable from the page source, plus an "Open an issue on GitHub"
  button; linked from every page footer. Removed the plaintext `mailto:` addresses that were
  exposed in `privacy.html` and `thanks.html` (they now point to the Contact page).
- feat: show a confirmation after a drawing is exported — the desktop GUI pops an "Export
  complete" message box (for SVG/PNG/PDF saves and cloud uploads) and the web app shows an
  "Exported as <filename>" alert after each SVG/PNG/PDF download, so it's clear the export
  succeeded.
- feat: drawing management — **rename**, **merge**, and **automerge** — in both the desktop GUI
  and the web app. Rename gives a drawing a custom label shown on its tab (instead of the
  timestamp) and used as the default export filename; the timestamp identity/filename is
  unchanged. Merge adds a `Select` mode with a checkbox per drawing and a `Merge` button that
  concatenates the chosen drawings' strokes into one new drawing and permanently deletes the
  originals (irreversible, confirmed first) — locally and in the cloud when connected. Automerge
  is a switch that, while on, appends every newly synced (and, on desktop, live-saved) drawing
  into a single canvas instead of a new file; toggling it starts a fresh merged canvas. Desktop
  stores the label as `title` in the drawing JSON and the automerge state in a new
  `app_settings.ini`; web stores it as `name` on the record and the switch in `localStorage`.
- feat: add replay/forgery protection to the Ko-fi Pro-unlock webhook — `KOFI_VERIFICATION_TOKEN`
  is a static shared secret, not a per-request signature, so anyone who obtained it could forge
  unlimited fake "payments". New migration `006_kofi_events.sql` (`kofi_events` table, unique
  `kofi_transaction_id`) plus a Worker change that atomically claims each transaction id before
  granting Pro; an already-seen id (a genuine Ko-fi retry, a replayed capture, or a forged request
  reusing an old id) is now a no-op instead of re-granting. Deployed to the Worker — **migration
  006 must be run before any real purchase**, or the webhook will 500 until then (flagged urgent
  in TASKS.md)
- feat: export drawings as PNG and PDF in addition to SVG, in both the desktop GUI and the web app.
  Desktop tabs now have an `Export ▾` menu (Save as SVG… / PNG… / PDF…); web tabs gained Save PNG and
  Save PDF buttons. PNG is a transparent raster, PDF is a single white page. No new dependencies (desktop
  reuses Pillow; web uses built-in canvas APIs and a hand-built PDF that satisfies the site's strict CSP).
- fix: `005_storage_cap.sql`'s cap-enforcement trigger rejected every free-plan cloud upload
  (not just the 11th) with `42702 ambiguous_column` — a local variable named `owner_id`
  collided with `storage.objects`'s own `owner_id` column under Postgres's default
  `plpgsql.variable_conflict = error`. Renamed to `v_owner_id`. Needs re-running in the
  Supabase SQL editor (admin task, flagged urgent in TASKS.md) since the broken version is
  already live in production
- fix: cloud sync silently under-reported failures — `_cmdCloudSync()` always printed "Cloud
  sync complete." after a sync pass even when individual drawing uploads failed inside it, and
  `_retryPendingUploads()` only logged those failures to the console with no visible status.
  The status bar now shows the real error (e.g. "2 not yet in cloud — <actual error>") instead
  of a false success message
- fix: after `_retryPendingUploads()` marks a drawing as uploaded, the drawing list wasn't
  re-rendered, so its badge stayed on ☁↑ (pending) instead of flipping to ☁✓ even on success
- chore: remove completed ([x]) items from TASKS.md now that they're done; history lives in
  git log / CHANGELOG.md going forward
- feat: add migration `005_storage_cap.sql` — a `BEFORE INSERT` trigger on `storage.objects`
  that authoritatively enforces the free-plan 10-drawing cap server-side, so a bypassed or
  modified client can no longer upload past it (the existing client-side check in
  `supabase_store.js` still gives the fast, friendly error message; this is the backstop)
- feat: Profile → Cloud Storage now shows the connected Google Drive account's email and
  storage usage (`gdrive_store.js`'s new `getAccountInfo()`, via Drive's `about` endpoint —
  works with the `drive.appdata`-only scope, unlike the OAuth userinfo endpoint)
- feat: the drawings list now shows a loading state ("Sync now" button relabeled "Checking
  cloud…", status line updated) while cloud reconciliation runs, and reports "offline — cloud
  drawings unavailable" instead of silently showing a plain drawing count when a cloud fetch
  fails due to a network error rather than an API/auth error
- fix: offline sync no longer sends `SET_MODE idle` after finishing — it left the tablet unable
  to record new offline drawings until the next connection re-authorized it; the device now
  stays in the paper mode set earlier in the same handshake
- fix: `live.js`'s `startLive()` sent CONNECT and `SET_MODE live` fire-and-forget, so a device
  rejection (not ready, wrong state) went unnoticed and live mode would silently never receive
  data; both commands are now ACK-checked and throw a clear error immediately
- fix: `register.js`'s `waitForNotification()` had the same `stopNotify()` race already fixed in
  `sync.js`'s `exchange()` — resolving before the BLE stack's unsubscribe finished could let an
  in-flight cleanup silently turn notifications back off right as the next wait started listening
- docs: add a "Ko-fi Pro unlock (admin)" section to README.md with Table Editor / SQL Editor
  steps for manually granting Pro when a buyer's Ko-fi email doesn't match their PandaInk account
  (the webhook's email-match unlock silently no-ops in that case)
- feat: the Profile panel's Upgrade-to-Pro banner now reminds the user to pay with the same email
  as their PandaInk account, since that's how the Ko-fi webhook matches the purchase to unlock Pro
- feat: move the Google Drive OAuth "authorize" step server-side — the Worker now exposes
  `GET /oauth/google/authorize`, which builds the Google consent-screen URL using the Client ID
  (a Worker secret) and redirects the browser to it. `docs/auth/storage_oauth.js` no longer ships
  any Google client_id/secret or the legacy no-Worker fallback path; Drive backup now requires the
  Worker
- feat: add `docs/thanks.html`, the post-purchase redirect page for the Ko-fi Pro shop item —
  confirms the purchase and explains the email-match unlock without claiming to verify anything
  client-side
- fix: `worker/wrangler.toml`'s Durable Object migration used `new_classes`, which Cloudflare's
  free plan rejects (Durable Objects there must be SQLite-backed); switched to
  `new_sqlite_classes` so the Worker deploys successfully
- docs: add a privacy policy page (`docs/privacy.html`) covering account/device/drawing data, cloud provider access (with the Google API Services Limited Use disclosure for the `drive.appdata` scope), payments via Ko-fi, live-sharing, third-party services, and data deletion — required for Google OAuth verification. Linked from every page footer
- feat: implement the three-tier cloud storage model — a new `docs/storage/cloud_store.js` abstraction picks the active provider from `profiles.storage_provider` and gates the paid ones on `profiles.plan`. Adds `supabase_store.js` (free tier, private bucket, 10-drawing cap enforced client-side), `dropbox_store.js` + `dropbox_oauth.js` (paid, secretless PKCE), and keeps `gdrive_store.js` (paid). New migrations `003_plan.sql` (adds `profiles.plan`, RLS blocks self-upgrade) and `004_storage.sql` (private `drawings` bucket + owner RLS)
- feat: cloud sync is now auto-in-background plus a manual "Sync now" — uploads after each device sync, retries pending on load, and reconciles cloud-only drawings (from other devices) into the local list. Each drawing tab shows a cloud badge (☁✓ synced / ☁↑ pending / ● local)
- feat: tier-gated storage picker in Profile — choose Supabase / Google Drive / Dropbox (paid ones locked on the free plan) with an "☕ Upgrade to Pro" button; Pro is a one-time $5 Ko-fi purchase
- feat: finish the auth workflow — "Forgot password?" reset + set-new-password recovery panel, and real account deletion via the backend (replaces the old sign-out stub)
- feat: add the Cloudflare Worker backend (`worker/`) — Google OAuth token exchange/refresh (secret stays server-side), account deletion (service-role), the Ko-fi Pro-unlock webhook, and a `LiveSession` Durable Object; the frontend routes through it when `WORKER_BASE_URL` is set and falls back gracefully otherwise
- feat: live-session sharing — a "Share this session" toggle publishes captured strokes to the Worker and produces a `?watch=` link that other signed-in users can open to spectate in real time
- feat: add Ko-fi support links (`https://ko-fi.com/dan1elsan`) across the site — a "☕ Support on Ko-fi" link in every page footer (index/features/download/app), a dedicated "Support PandaInk" section on the landing page, and a support link in the web-app Profile panel. Corrects `.github/FUNDING.yml` (was the wrong username `danielemarsico`)
- docs: document the paid-tier "Pro unlock via Ko-fi" flow in RULEBOOK.md/TASKS.md — Ko-fi membership/shop for the paid plan, a Cloudflare Worker webhook that verifies the payment and sets `profiles.plan = 'pro'` (matched by payer email), and a manual interim (owner flips the flag in Supabase) until the Worker ships
- docs: plan the next web-app enhancements in RULEBOOK.md/TASKS.md — a three-provider tiered cloud-storage model (Supabase Storage free with a 10-drawing cap; Google Drive + Dropbox as paid providers gated by a new `profiles.plan` flag), an auto-background-plus-manual cloud sync with cross-device reconciliation and per-drawing cloud badges (☁︎✓ synced / ☁︎↑ pending / ☁︎↓ cloud-only), and a switch of the planned Phase-2 backend from Render (Python) to a Cloudflare Worker that holds OAuth client secrets, does token exchange/refresh, enforces the storage cap, handles account deletion, and broadcasts live sessions to viewers via a Durable Object. Also documents finishing the Supabase auth workflow (password-reset UI, real account deletion) and refreshes the stale `idb_store.js` note in `.claude/CLAUDE.md`
- fix: drawings still showed as a blank canvas in the web app (while SVG export was correct) — the stroke line width was given in coordinate units, but the canvas context is scaled by ~0.0015 to fit the drawing, collapsing every line to ~0.002 px (invisible). The width is now expressed in on-screen pixels (divided by the scale factor), and stroke style/caps are set unconditionally, so strokes render at a visible 0.75–2.5 px
- fix: synced drawings rendered blank (empty canvas and empty SVG) even though the strokes downloaded correctly — the stroke coordinates were left in raw device points while the tablet `dimensions` were stored in µm (points × point size), a 10× mismatch that squeezed every drawing into an invisible speck in one corner. `sync.js` now scales coordinates by the point size (→ µm, matching `dimensions`) and normalizes pressure to a 16-bit range, mirroring `wacom_win.py`'s `parse_pen_data()`
- fix: tapping a drawing tab closed it instead of opening it — the whole tab label ended with "×", and the click handler treated any click ending in "×" as a close, so every tap dismissed the drawing. The date label and the "×" close button are now separate click targets
- fix: sync failed at the download step with "No Characteristics matching UUID ffee0003-… found in Service … 6e400001-…" — `BleManager` fetched only the Nordic UART service and resolved every characteristic against it, but the offline pen-data characteristic (`ffee0003`) lives in the separate Wacom offline service (`ffee0001`). It now discovers every service the device exposes at connect time and resolves each characteristic against whichever service actually contains it, so the pen-data download can subscribe to its notification channel
- feat: syncing right after drawing no longer fails immediately with "device not in sync mode". The pad reports INVALID_STATE on CONNECT while it's in its active/drawing state, so sync now retries CONNECT for ~25 seconds while prompting "Press the button on the device (LED solid green) to start sync…" with a countdown — the moment the pad goes green the sync proceeds on its own, instead of forcing a manual retry at exactly the right instant. After the timeout it still shows the clear not-ready guidance
- fix: data-loss protection during multi-drawing sync — each drawing is now saved to local storage **inside** the sync loop, immediately after it's parsed and **before** the device is told to delete it (`DELETE_OLDEST`). Previously all drawings were saved only after the entire sync finished, so a failure partway through a large sync (the device can hold dozens of drawings) would have deleted the already-downloaded files from the device without ever saving them. If a local save fails, the sync now stops before deleting that file, leaving it on the device for a retry; drawings saved on earlier iterations stay safe
- fix: the real cause of "Device rejected battery/file-count query (error code 0x1)" — commands sent with no arguments (GET_BATTERY, AVAILABLE_FILES, GET_STROKES, DOWNLOAD_OLDEST, DELETE_OLDEST) were transmitted with a zero-length payload, but Wacom messages are never empty: the reference always sends at least a single 0x00 byte (protocol.py `Msg` defaults `args = [0x00]`, "Empty messages don't exist"). The device rejected every length-0 command with a generic 0x01 error while commands that happened to carry ≥1 argument byte worked. `buildPacket()` now emits a single 0x00 payload for empty argument lists, so an argument-less command goes out as `[opcode, 0x01, 0x00]` — matching the device's (and Python's) expectation. This unblocks the whole offline-sync data path
- feat: Profile → Diagnostics now has a **Verbose sync log** switch with an on-screen log viewer and Copy button, so the sync trace can be captured on a phone (or any device without an accessible dev console). Toggle it on, run Sync, reopen Profile, and Copy the log to share it — no browser console needed. The trace is mirrored into an in-memory buffer that the panel reads
- chore: add an opt-in verbose sync trace to `sync.js` for hardware debugging — enable with `localStorage.setItem('pandaink_sync_trace','1')` (or `window.PANDAINK_SYNC_TRACE = true`) in the browser console, then Sync. It logs every command and raw reply (opcode name + hex bytes) through the whole handshake, the chosen dimensions, available-file count, per-file stroke count/timestamp, pen-data chunk sizes, and CRC — so a single console capture shows the full exchange. Off by default, no output unless enabled
- fix: sync no longer pushes past an unready device and fails on a later read (e.g. "Device rejected battery/file-count query (error code 0x1)"). A device that isn't in the sync-authorized state answers `INVALID_STATE` to `CONNECT` yet still accepts write commands (set time/mode) while rejecting the reads the sync depends on — so proceeding past that connect (previously borrowed from `live_mode()`) just produced a cryptic failure several steps later. Sync now stops immediately on an `INVALID_STATE` connect with clear, actionable guidance ("press the button until the LED is solid green, then Sync again"), matching the reference's `retrieve_data()`, and the UI shows it as guidance rather than a red "Sync error"
- fix: sync crashed with "Offset is outside the bounds of the DataView" at the available-files step — the file-count reply was parsed by blindly reading `getUint8(3)` with no opcode or length check, so a device with no drawings (which answers with a short generic ACK) read past the end of the packet. The AVAILABLE_FILES (`0xc2`) and GET_STROKES (`0xcf`) replies are now validated by opcode and length before any field is read: a bare ACK for the file count is treated as "0 drawings", a genuine INVALID_STATE surfaces the not-ready message, and every field read is bounds-guarded so a truncated reply gives a clear error instead of a DataView crash
- chore: the Windows build workflow (`build.yml`) no longer runs on pull requests — it now triggers only on push to `master` and on `v*` release tags, so opening/updating a PR from a feature branch no longer spends CI minutes on a Windows build
- fix: sync aborted with "Device rejected battery (error code 0x1)" on devices that don't support the battery/firmware getters — these handshake queries are sent only because the device expects them in sequence, and their results are unused, so a device error on one (e.g. GENERAL_ERROR for an unsupported battery getter) no longer kills the whole offline-data retrieval. The battery, firmware and dimensions queries are now treated as optional: a device error is downgraded to a console warning and the sync continues (dimensions falls back to the Slate defaults). A genuine INVALID_STATE (device not ready) is still surfaced, and the actual data operations (file count, stroke download, delete) remain strict
- fix: syncing right after drawing failed with "Device is not ready to connect (invalid state)… make sure the LED is blue" even though the device had drawings to import — the initial `CONNECT` step aborted the whole sync on an `INVALID_STATE` (0x02) reply, but the device often returns that spuriously on connect while still being perfectly able to sync. `wacom_win.py`'s `live_mode()` ignores exactly this and proceeds, so the web sync now does the same: it logs a warning and continues the handshake instead of bailing. The old LED guidance was also backwards (it told the user to make the LED blue, the drawing state); genuine not-ready errors now use the reference's correct wording — press the button until the LED is solid green — consistent with `live_mode()`'s message
- fix: sync failed with "Unexpected battery reply (opcode 0xb3)" on devices (e.g. Bamboo Folio) that have no real battery getter — the sync handshake demanded the dedicated `0xba` battery reply, but per protocol.py's `Msg.execute()` a `0xb3` generic ACK is always a valid success (payload byte 0 == 0x00), and such devices simply ACK the battery query. Battery and firmware queries now accept the generic ACK (their results are unused anyway), and the dimensions query falls back to the Slate defaults if it's ACKed rather than answered with data. A `0xb3` reply with a non-zero status is still surfaced as a clear device-error message
- feat: drawings now save to and load from the browser's local IndexedDB store, so the web app works with **no cloud provider configured** — previously sync bailed with "Connect Google Drive in Profile → Cloud Storage first" and nothing was ever stored or shown. Each synced drawing is written to IndexedDB immediately (before any cloud call, so the device deleting it during sync can't lose it), the drawing list renders from IndexedDB on page load (before any BLE reconnect), and delete removes the local copy. Google Drive, when connected, becomes an optional best-effort upload layered on top: successful uploads mark the local record and retained local copies are retried if an upload was pending. Revived `docs/storage/idb_store.js` (was unused legacy) and added `updateDrawing()`
- fix: registration appeared to do nothing and login/auth errors were invisible — the auth panel's message helper set `el.style.display = ''` to reveal a message, but that clears the inline style and falls back to the stylesheet's `.auth-msg { display: none }`, so the text was set but never shown. After a successful sign-up (which, with email confirmation on, does not log you in) the only feedback is the "Account created! Check your email to confirm." message, so the whole flow looked broken. The helper now sets an explicit `display: block`, making both the confirmation and any auth error text visible
- fix: web sync no longer hangs 30 s then fails with "Timeout waiting for pen data CRC packet" on Bamboo Slate/Folio — `readOfflinePenData()` only recognized the Spark-family end-of-download reply (`0xc9`), but Slate-protocol devices signal it with `0xc8 [0xed, CRC]` instead (C1, TASKS.md). It now accepts both markers, skips the initial `0xc8 [0xbe]` "download starting" ack without mistaking it for the end, and verifies the device's CRC32 against the downloaded pen data (as `wacom_win.py`'s `wait_for_end_read()` does), failing the sync loudly on corruption instead of saving garbage
- fix: rewrite the web stroke-file parser to classify packets by header **and** payload like the Python reference (`StrokeDataType.identify`), fixing five bugs that made Slate/Folio drawings come out empty or corrupted (C2, TASKS.md): the EOF check matched every absolute point packet (so parsing stopped at the first pen-down point); Slate stroke headers (`0xff 0xee 0xee` payload) weren't recognized; `0xfc`-header end-of-stroke packets were misparsed as deltas, injecting spurious (65535, 65535) corner points; points with non-`0xff` headers (e.g. `0xbf`) used the wrong axis mask and desynced the parser; and lost-point markers (`0xdd 0xdd`) were misparsed as coordinates. The new parser produces byte-for-byte identical output to the Python parser on 50 randomized reference streams plus directed edge cases
- docs: correct RULEBOOK.md's offline-sync and stroke-file-format sections to match the reference protocol (Slate vs Spark end-of-download markers, CRC verification, full packet classification order)
- docs: add RULEBOOK.md as the source of truth for features and intended behavior — covers the four device-connection methods (CLI, GUI, web app, planned ESP32), a full text description of the Wacom SmartPad BLE protocol (transport, framing, registration, connection, offline sync, stroke file format, live mode) extracted from the Python reference, web app cloud-storage rules (Google Drive + planned 10-drawing-capped Supabase Storage, single active provider, required IndexedDB loss-protection buffer), and the planned Phase 2 web architecture (Vercel frontend, Render Python backend with spin-down design constraints, Supabase DB); CLAUDE.md now points to it
- docs: add detailed TASKS.md entries for the two critical web-BLE sync bugs found by auditing sync.js against the Python reference (wrong end-of-download marker for Slate/Folio devices; stroke-file parser can't classify Slate packets), plus follow-up fixes and the cloud-storage task breakdown (local loss-protection buffer, Supabase Storage provider, provider selection UI)
- fix: reconnecting to a device (e.g. after a page reload or a dropped connection) and then syncing crashed with `InvalidStateError: Characteristic ... is no longer valid` — `BleManager` cached GATT characteristic objects across reconnects, but those references are tied to the specific GATT session they were retrieved from and go stale once it drops, even when reconnecting to the same device. `connect()` now clears the characteristic/notify-handler caches before establishing the new session
- fix: back-to-back BLE commands (introduced by the new pre-sync handshake) could time out unpredictably — `exchange()`'s cleanup (`stopNotify()`) ran fire-and-forget and could still be in flight when the next command's `startNotify()` re-subscribed; `ble_manager.js`'s stale cleanup would then delete the new handler and silently turn notifications back off mid-wait. Replies now only resolve after their cleanup actually finishes, so the next command can't start until the previous one's unsubscribe has settled. Also gives a clear, actionable message when the device rejects a connection with `INVALID_STATE` (the documented "make sure the LED is blue, press the button" condition) instead of a bare error code
- fix: sync crashed with `RangeError: Offset is outside the bounds of the DataView` querying the available-file count — the device was rejecting that query with a generic ACK error because `syncDrawings()` was missing an entire required pre-sync handshake (set time, query battery, query dimensions, query firmware, and properly ACK-checked file-transfer/paper-mode setup) that `wacom_win.py`'s Slate-family `retrieve_data()` always performs first. Also fixed a latent bug in the very next step: the per-file stroke-count reply's timestamp is BCD-encoded, not a raw little-endian integer, so it was silently producing garbage dates. `syncDrawings()` now also returns real queried tablet dimensions instead of a hardcoded Spark-family guess
- fix: connect always failed with `Device rejected connection (opcode 0xb3)` for Spark/Slate/Folio devices — `syncDrawings()` only accepted a raw `0x50` (`REPLY_CONNECT_OK`) reply opcode, but these devices reply with the generic ACK opcode (`0xb3`) whose payload's first byte indicates success/failure instead, per `protocol.py`'s `Msg.execute()` dispatch. Now checks the ACK payload byte for these devices, falling back to raw `0x50`/`0x51` handling for Intuos Pro
- fix: every device sync always failed with `Timeout waiting for reply to 0xe6` — `sync.js`'s `exchange()` helper awaited the reply promise *before* writing the command that would trigger a reply, so the command was never actually sent until the wait had already started, guaranteeing a timeout on every exchange. Also fixed the same subscribe-after-trigger ordering bug in `readOfflinePenData()`, which could miss offline pen data that arrived before its notification listeners were subscribed
- fix: Sync/Start Live crashed with `Cannot read properties of null (reading 'getCharacteristic')` when clicked right after a page reload — a registered device loads from Supabase and enables those buttons immediately, but the BLE GATT connection doesn't survive a reload, so `this._ble._service` was still null. Both now reconnect first via a shared `_ensureBleConnected()` before touching any GATT characteristic
- fix: "Forget device" (toolbar button and profile panel) no longer deletes cloud drawings — it now only unlinks the device registration; drawings are only ever removed via the explicit per-drawing Delete button. Previously it deleted every cloud drawing outright, and briefly (in an intermediate fix) could still unlink the device even if that deletion failed, orphaning files in Drive under an unreachable device id — this replaces both with "unlink only, never touch Drive"; removed the now-unused `deleteAllDrawings()` from `gdrive_store.js`
- feat: add a live connection-status dot next to the device name in the web app toolbar — previously a registered-but-not-BLE-connected device looked identical to a connected one, since the label was always styled green regardless of actual GATT connection state
- fix: `app_controller.js` built `_deviceInfo` with a `wacom_uuid` key (matching the Supabase column name) but `sync.js`/`live.js` read `deviceInfo.uuid`, causing `Cannot read properties of undefined (reading 'length')` in `hexBytes()` on every Sync/Live attempt — renamed to `uuid` to match what the BLE modules expect
- docs: add explicit security-tradeoff callout in README explaining what the publicly-shipped Drive client_secret does and doesn't expose, plus mitigation options
- fix: Google requires client_secret on the token/refresh exchange for Web application OAuth clients even with PKCE — add `GDRIVE_CLIENT_SECRET` to `storage_oauth.js`'s token and refresh requests, fixing `invalid_request: client_secret is missing` on Drive connect
- docs: correct README's claim that the Drive OAuth client needs no secret; document the client_secret + PKCE tradeoff for static sites with no backend
- fix: README incorrectly told readers to add only the origin (no path) to the Drive client's Authorized redirect URIs, causing `redirect_uri_mismatch` — now specifies the full page URL as required by `REDIRECT_URI` in `storage_oauth.js`
- docs: document Supabase's default `localhost:3000` OAuth redirect and how to fix it via Site URL / Redirect URLs in README setup steps
- docs: explain the two separate Google OAuth clients required (Drive access vs Supabase login) in README, with a comparison table and split setup steps (2b/2c) — the two were previously conflated
- docs: fix stale line-number references in README Web App Setup, add migration 002 to the Supabase setup steps, and clarify that Google Drive test users and Supabase login users are separate whitelists
- chore: fill in live Google Drive OAuth client ID in `docs/auth/storage_oauth.js`, enabling cloud storage connection on the deployed web app
- fix: add missing unique constraint on `devices.user_id` (migration 002) — `saveDevice()`'s `upsert(..., { onConflict: 'user_id' })` was failing with a 400 because no such constraint existed
- chore: fill in live Supabase project URL and anon key in `docs/auth/supabase_client.js`, enabling auth on the deployed web app
- docs: document `docs/storage/idb_store.js` as unused/legacy in CLAUDE.md architecture; fix stale `idb_store` reference in a `drawing_canvas.js` comment
- docs: update README with web app features, auth/cloud architecture, and full external setup instructions (Supabase, Google Cloud, GitHub OAuth)
- chore: consolidate remaining tasks into single .claude/tasks/current.md (Windows App + Web App sections); remove completed/stale plan files
- chore: move CLAUDE.md to .claude/CLAUDE.md; add Windows App and Web App architecture sections

- feat: Supabase auth — email+password, Google login, GitHub login; auth panel shown when logged out
- feat: profile settings panel — account info, cloud storage connection, device management
- feat: Google Drive PKCE OAuth — connect Drive in Profile Settings, tokens stored in Supabase
- feat: drawings stored in Google Drive appDataFolder (one JSON file per drawing)
- feat: device config (wacom_uuid + protocol) stored in Supabase — enables cross-computer reconnect
- feat: auth toolbar row — avatar, email, Profile button, Sign out
- refactor: register.js removes localStorage dependency; Supabase is now authoritative for device config
- chore: Supabase migration SQL (001_init.sql) with profiles, devices, storage_tokens tables + RLS
- feat: show build commit + timestamp in web app footer (auto-stamped by CI)
- fix: web BLE device picker now uses `acceptAllDevices` so registered devices appear regardless of advertised services
- fix: web BLE registration skips intermediate ACK (0xb3) when waiting for REGISTER_WAIT reply
- fix: web BLE write uses `writeValueWithoutResponse` to match Python bleak `response=False`
- fix: `isSpark()` now checks for the SYSEVENT *service* (not a characteristic in the wrong service), correctly identifying Slate/Bamboo Folio devices
- fix: device record stored with `id` field to satisfy IndexedDB keyPath requirement
- chore: save web app plan and task list under `.claude/`
- chore: add CHANGELOG rule to CLAUDE.md

---

## 0.1.1 — 2024-12-01

- feat: Windows installer (Inno Setup) produced by CI alongside portable EXE
- feat: Help dialog with 4-tab Notebook (Getting Started, Live Mode, Shortcuts, About)
- feat: Live mode — real-time pen streaming to canvas
- feat: Stop Live auto-saves session as a drawing tab
- feat: device button press surfaced as toast in GUI and stdout in CLI
- feat: GitHub Pages website (index, features, download, web app pages)
- feat: Web BLE app — connect, register, sync drawings, live mode, SVG export
- fix: live mode orientation and canvas rendering
- chore: CI build for portable EXE and installer on push to master and v* tags

## 0.1.0 — 2024-10-01

- feat: initial Windows port of Tuhi (BLE via bleak, no BlueZ dependency)
- feat: Tkinter GUI with Normal and Live modes
- feat: CLI commands: list, search, listen, fetch, live
- feat: SVG export with cloud upload (Google Drive, Dropbox, OneDrive)
- feat: drawings stored in `%APPDATA%\pandaink\`
