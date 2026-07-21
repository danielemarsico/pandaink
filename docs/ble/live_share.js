// Live-session sharing transport — WebSocket to the Cloudflare Worker's
// LiveSession Durable Object. The host publishes captured pen points; viewers
// subscribe and render them. Capture stays in the browser (Web Bluetooth);
// this only relays the parsed points.

import { WORKER_BASE_URL, hasWorker } from '../config.js';
import { getSession } from '../auth/auth_manager.js';

function wsBase() {
    return WORKER_BASE_URL.replace(/^http/i, 'ws');
}

async function openLiveSocket(sessionId) {
    if (!hasWorker()) throw new Error('Live sharing needs the backend (WORKER_BASE_URL not set).');
    const session = await getSession();
    if (!session) throw new Error('Sign in to use live sharing.');

    const url = `${wsBase()}/live/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(session.access_token)}`;
    const ws  = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open',  resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error('Live socket failed to open')), { once: true });
    });
    return ws;
}

// Host side: returns { send(x,y,p,inProx), close() }.
export async function publishLiveSession(sessionId) {
    const ws = await openLiveSocket(sessionId);
    return {
        send(x, y, p, inProx) { try { ws.send(JSON.stringify({ x, y, p, inProx })); } catch {} },
        close() { try { ws.close(); } catch {} },
    };
}

// Viewer side: onPoint(x, y, pressure, inProximity) for each relayed point.
export async function subscribeLiveSession(sessionId, onPoint) {
    const ws = await openLiveSocket(sessionId);
    ws.addEventListener('message', (evt) => {
        try { const d = JSON.parse(evt.data); onPoint(d.x, d.y, d.p, d.inProx); } catch {}
    });
    return { close() { try { ws.close(); } catch {} } };
}

// A random, URL-safe session id for a new shared session.
export function newSessionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
