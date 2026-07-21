// PandaInk web-app configuration.
//
// These values are filled in by the project owner (admin) after the external
// services are set up. Everything here is PUBLIC (it ships in the frontend
// bundle) — never put a client SECRET here. Secrets live in the Cloudflare
// Worker's environment (see worker/README.md).
//
// Until WORKER_BASE_URL is set, the paid providers (Google Drive / Dropbox)
// that need server-side token exchange stay unavailable; the free Supabase
// Storage provider and the always-on local IndexedDB store work regardless.

// Base URL of the deployed Cloudflare Worker, e.g.
//   https://pandaink-api.<your-subdomain>.workers.dev
// Empty string = no backend configured yet.
export const WORKER_BASE_URL = 'https://pandaink-api.marsicod.workers.dev';

// Public Dropbox app key (App Console → your app → "App key").
// The Dropbox app secret is NOT here — it lives in the Worker.
export const DROPBOX_CLIENT_ID = '';

// Ko-fi one-time purchase link that grants Pro ($5). Create a Ko-fi Shop item
// and paste its share link here, e.g. https://ko-fi.com/s/xxxxxxxxxx
export const KOFI_PRO_URL = 'https://ko-fi.com/s/142aa079df';

// Public Ko-fi support/tip page (donations, no account effect).
export const KOFI_SUPPORT_URL = 'https://ko-fi.com/dan1elsan';

// Convenience: whether a backend is configured at all.
export function hasWorker() {
    return typeof WORKER_BASE_URL === 'string' && WORKER_BASE_URL.length > 0;
}
