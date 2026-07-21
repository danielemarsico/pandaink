// Dropbox OAuth (authorization code + PKCE) + token persistence in Supabase.
//
// Unlike Google's "Web application" clients, Dropbox supports PKCE WITHOUT a
// client secret, so this flow runs entirely in the browser — no Worker needed.
// The app key (DROPBOX_CLIENT_ID) is public.
//
// Setup (Dropbox App Console — https://www.dropbox.com/developers/apps):
//   1. Create app → Scoped access → App folder → name it (e.g. PandaInk).
//   2. Permissions: files.content.write, files.content.read, files.metadata.read.
//   3. OAuth 2 → Redirect URIs: https://danielemarsico.github.io/pandaink/app.html
//   4. Copy the "App key" into DROPBOX_CLIENT_ID in docs/config.js.

import { supabase } from './supabase_client.js';
import { DROPBOX_CLIENT_ID } from '../config.js';

const AUTH_ENDPOINT   = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_ENDPOINT  = 'https://api.dropboxapi.com/oauth2/token';
const SCOPES          = 'files.content.write files.content.read files.metadata.read account_info.read';
const PROVIDER        = 'dropbox';
const REDIRECT_URI    = window.location.origin + window.location.pathname;
const VERIFIER_KEY    = 'pandaink_dropbox_verifier';
const STATE_KEY       = 'pandaink_dropbox_state';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function generateCodeVerifier() {
    return base64url(crypto.getRandomValues(new Uint8Array(96)));
}
async function generateCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(digest);
}

// ── OAuth redirect ────────────────────────────────────────────────────────────

export async function startDropboxAuth() {
    if (!DROPBOX_CLIENT_ID) throw new Error('Dropbox is not configured yet (missing DROPBOX_CLIENT_ID).');
    const verifier  = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state     = base64url(crypto.getRandomValues(new Uint8Array(16)));

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
        client_id:             DROPBOX_CLIENT_ID,
        redirect_uri:          REDIRECT_URI,
        response_type:         'code',
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        token_access_type:     'offline',   // returns a refresh token
        scope:                 SCOPES,
        state,
    });
    window.location.href = AUTH_ENDPOINT + '?' + params.toString();
}

// ── Callback handler ──────────────────────────────────────────────────────────

// Call on page load when ?code= is present. Returns true if a Dropbox code was
// handled (state matched Dropbox's), false otherwise.
export async function handleDropboxCallback() {
    const params      = new URLSearchParams(window.location.search);
    const code        = params.get('code');
    const state       = params.get('state');
    const storedState = sessionStorage.getItem(STATE_KEY);
    if (!code || !storedState || state !== storedState) return false;

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error('PKCE verifier missing from sessionStorage');

    const body = new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        code_verifier: verifier,
        client_id:     DROPBOX_CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
    });
    if (!res.ok) throw new Error(`Dropbox token exchange failed: ${await res.text()}`);

    await _saveTokens(await res.json());

    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    history.replaceState(null, '', window.location.origin + window.location.pathname);
    return true;
}

// ── Token management ──────────────────────────────────────────────────────────

async function _saveTokens(tokens) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in to PandaInk');

    const record = {
        user_id:       user.id,
        provider:      PROVIDER,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at:    tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
    };
    const { error } = await supabase
        .from('storage_tokens')
        .upsert(record, { onConflict: 'user_id,provider' });
    if (error) throw new Error('Failed to save Dropbox tokens: ' + error.message);
}

export async function getValidAccessToken() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in to PandaInk');

    const { data, error } = await supabase
        .from('storage_tokens').select('*')
        .eq('user_id', user.id).eq('provider', PROVIDER).single();
    if (error || !data) throw new Error('Dropbox not connected. Go to Profile → Cloud Storage.');

    const expiring = data.expires_at && (new Date(data.expires_at).getTime() - Date.now() < 60_000);
    if (expiring) {
        if (!data.refresh_token) throw new Error('Dropbox access expired. Please reconnect Dropbox.');
        const body = new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: data.refresh_token,
            client_id:     DROPBOX_CLIENT_ID,
        });
        const res = await fetch(TOKEN_ENDPOINT, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    body.toString(),
        });
        if (!res.ok) throw new Error('Dropbox token refresh failed. Please reconnect Dropbox.');
        const refreshed = await res.json();
        await _saveTokens({ ...refreshed, refresh_token: data.refresh_token });
        return refreshed.access_token;
    }
    return data.access_token;
}

export async function isDropboxConnected() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
        .from('storage_tokens').select('user_id')
        .eq('user_id', user.id).eq('provider', PROVIDER).maybeSingle();
    return !!data;
}

export async function disconnectDropbox() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('storage_tokens').delete()
        .eq('user_id', user.id).eq('provider', PROVIDER);
    await supabase.from('profiles').update({ storage_provider: null }).eq('id', user.id);
}
