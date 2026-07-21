# PandaInk Worker (Cloudflare)

Backend for the PandaInk web app: OAuth token exchange (holds client secrets),
account deletion, the Ko-fi Pro-unlock webhook, and live-session broadcast.
The frontend (GitHub Pages) never holds a secret; it calls this Worker.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | health check |
| GET  | `/oauth/google/authorize` | builds the Google authorize URL server-side (holds Client ID) and redirects the browser |
| POST | `/oauth/google/token` | exchange a Drive auth code (holds Google secret) |
| POST | `/oauth/google/refresh` | refresh a Drive access token |
| POST | `/account/delete` | delete the caller's account (Bearer = Supabase token) |
| POST | `/kofi/webhook` | Ko-fi payment → set `profiles.plan = 'pro'` by email |
| WS   | `/live/<sessionId>?token=<supabase_jwt>` | live-stroke broadcast |

Dropbox uses secretless PKCE and is handled entirely in the browser, so it has
no Worker endpoint.

## Deploy

```sh
cd worker
npm install -g wrangler        # or: npx wrangler ...
wrangler login

# Set secrets (never commit these):
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REDIRECT_URI          # https://danielemarsico.github.io/pandaink/app.html
wrangler secret put SUPABASE_URL                 # https://<project>.supabase.co
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY    # Settings → API → service_role (secret!)
wrangler secret put KOFI_VERIFICATION_TOKEN      # Ko-fi → More → API / Webhooks

# Edit ALLOWED_ORIGIN in wrangler.toml if your Pages origin differs, then:
wrangler deploy
```

After deploy, copy the Worker URL (e.g. `https://pandaink-api.<you>.workers.dev`)
into `docs/config.js` → `WORKER_BASE_URL`, and set the Ko-fi webhook URL to
`<WORKER_URL>/kofi/webhook`.

## Notes

- Fully stateless except the `LiveSession` Durable Object, which holds only the
  in-memory WebSocket set for an active session.
- Kept off the critical device-sync path: BLE sync + local IndexedDB save work
  even if the Worker is down; only cloud token ops, deletion, Pro unlock, and
  live broadcast need it.
