// PandaInk backend — Cloudflare Worker.
//
// Responsibilities (see RULEBOOK.md → "Web Development Phases"):
//   - Google Drive OAuth token exchange/refresh (holds the client secret).
//   - Account deletion (Supabase service-role admin API).
//   - Ko-fi webhook → grant Pro (profiles.plan = 'pro') by payer email.
//   - Live-session broadcast over WebSocket (LiveSession Durable Object).
//
// Secrets are provided via Worker environment (wrangler secret put ...), never
// shipped to the browser. See wrangler.toml for the list.

// ── CORS ───────────────────────────────────────────────────────────────────────

function corsHeaders(env) {
    return {
        'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age':       '86400',
    };
}

function json(body, env, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
    });
}

function text(body, env, status = 200) {
    return new Response(body, { status, headers: corsHeaders(env) });
}

// ── Google OAuth ────────────────────────────────────────────────────────────────

async function googleToken(req, env) {
    const { code, code_verifier, redirect_uri } = await req.json();
    const body = new URLSearchParams({
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirect_uri || env.GOOGLE_REDIRECT_URI,
        grant_type:    'authorization_code',
        code,
        code_verifier,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const data = await res.json();
    return json(data, env, res.ok ? 200 : 400);
}

async function googleRefresh(req, env) {
    const { refresh_token } = await req.json();
    const body = new URLSearchParams({
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const data = await res.json();
    return json(data, env, res.ok ? 200 : 400);
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function supabaseUserFromToken(env, accessToken) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: 'Bearer ' + accessToken, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    return res.json();  // { id, email, ... }
}

async function supabaseAdmin(env, path, init = {}) {
    return fetch(`${env.SUPABASE_URL}${path}`, {
        ...init,
        headers: {
            apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
}

// ── Account deletion ────────────────────────────────────────────────────────────

async function deleteAccount(req, env) {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return text('Missing Authorization', env, 401);

    const user = await supabaseUserFromToken(env, token);
    if (!user?.id) return text('Invalid session', env, 401);

    // Delete the auth user; FK cascade removes profiles / devices / storage_tokens.
    const res = await supabaseAdmin(env, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
    if (!res.ok) return text('Delete failed: ' + await res.text(), env, 500);
    return json({ ok: true }, env);
}

// ── Ko-fi webhook → Pro unlock ──────────────────────────────────────────────────

async function kofiWebhook(req, env) {
    // Ko-fi posts application/x-www-form-urlencoded with a single 'data' field (JSON).
    const form = await req.formData();
    let payload;
    try { payload = JSON.parse(form.get('data')); }
    catch { return text('Bad payload', env, 400); }

    if (payload.verification_token !== env.KOFI_VERIFICATION_TOKEN) {
        return text('Bad verification token', env, 401);
    }

    const email = (payload.email || '').trim().toLowerCase();
    if (!email) return text('No email in payload', env, 400);

    // Find the Supabase user with this email.
    const listRes = await supabaseAdmin(env, `/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
    if (!listRes.ok) return text('User lookup failed', env, 500);
    const list = await listRes.json();
    const user = (list.users || list)?.[0];
    if (!user?.id) {
        // No matching account yet — accept the webhook (200) so Ko-fi doesn't retry
        // forever; the owner reconciles manually (see RULEBOOK "Pro unlock via Ko-fi").
        return json({ ok: true, matched: false }, env);
    }

    // Grant Pro. (service-role bypasses RLS.)
    const upd = await supabaseAdmin(
        env,
        `/rest/v1/profiles?id=eq.${user.id}`,
        { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ plan: 'pro' }) },
    );
    if (!upd.ok) return text('Grant failed: ' + await upd.text(), env, 500);
    return json({ ok: true, matched: true }, env);
}

// ── Live-session broadcast (Durable Object) ─────────────────────────────────────

export class LiveSession {
    constructor(state) {
        this.state   = state;
        this.viewers = new Set();
    }

    async fetch(request) {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        this.viewers.add(server);

        server.addEventListener('message', (evt) => {
            // Fan out any message (stroke packets from the host) to all others.
            for (const ws of this.viewers) {
                if (ws !== server) { try { ws.send(evt.data); } catch {} }
            }
        });
        const drop = () => this.viewers.delete(server);
        server.addEventListener('close', drop);
        server.addEventListener('error', drop);

        return new Response(null, { status: 101, webSocket: client });
    }
}

async function liveConnect(request, env, sessionId) {
    if (request.headers.get('Upgrade') !== 'websocket') {
        return text('Expected WebSocket', env, 426);
    }
    // Require a valid Supabase session (token passed as ?token= for WS).
    const url   = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token || !(await supabaseUserFromToken(env, token))) {
        return text('Unauthorized', env, 401);
    }
    const id   = env.LIVE_SESSIONS.idFromName(sessionId);
    const stub = env.LIVE_SESSIONS.get(id);
    return stub.fetch(request);
}

// ── Router ───────────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const { pathname } = url;

        if (request.method === 'OPTIONS') return text('', env, 204);

        try {
            if (pathname === '/health') return json({ ok: true }, env);

            if (request.method === 'POST' && pathname === '/oauth/google/token')   return googleToken(request, env);
            if (request.method === 'POST' && pathname === '/oauth/google/refresh') return googleRefresh(request, env);
            if (request.method === 'POST' && pathname === '/account/delete')       return deleteAccount(request, env);
            if (request.method === 'POST' && pathname === '/kofi/webhook')         return kofiWebhook(request, env);

            const live = pathname.match(/^\/live\/([A-Za-z0-9_-]+)$/);
            if (live) return liveConnect(request, env, live[1]);

            return text('Not found', env, 404);
        } catch (e) {
            return text('Error: ' + (e?.message || e), env, 500);
        }
    },
};
