// Dropbox implementation of the cloud drawing store (paid tier).
// Files live in the app folder (App-folder scoped app) as:
//   /drawing_<timestamp>.json
//
// Same interface as gdrive_store.js:
//   saveDrawing(drawing) -> { ...drawing, driveFileId }   (driveFileId = Dropbox path)
//   fetchDrawings(deviceId) -> { drawings: [ { ...record, driveFileId } ], incomplete }
//   deleteDrawing(path)
//   isConnected()

import { getValidAccessToken, isDropboxConnected } from '../auth/dropbox_oauth.js';

const CONTENT_API = 'https://content.dropboxapi.com/2';
const RPC_API     = 'https://api.dropboxapi.com/2';

function _path(timestamp) {
    return `/drawing_${timestamp}.json`;
}

async function _token() {
    return getValidAccessToken();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveDrawing(drawing) {
    const token = await _token();
    const path  = _path(drawing.timestamp);
    const res = await fetch(`${CONTENT_API}/files/upload`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
        },
        body: JSON.stringify(drawing),
    });
    if (!res.ok) throw new Error(`Dropbox upload failed: ${res.status} ${await res.text()}`);
    return { ...drawing, driveFileId: path };
}

export async function fetchDrawings(deviceId) {
    const token = await _token();

    // List the app folder.
    const listRes = await fetch(`${RPC_API}/files/list_folder`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '', recursive: false }),
    });
    if (!listRes.ok) throw new Error(`Dropbox list failed: ${listRes.status} ${await listRes.text()}`);
    const { entries } = await listRes.json();
    const files = (entries ?? []).filter(
        (e) => e['.tag'] === 'file' && e.name.startsWith('drawing_') && e.name.endsWith('.json')
    );

    const out = [];
    let incomplete = false;
    for (let i = 0; i < files.length; i += 6) {
        const batch = files.slice(i, i + 6);
        const results = await Promise.all(batch.map(async (f) => {
            const dRes = await fetch(`${CONTENT_API}/files/download`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + token,
                    'Dropbox-API-Arg': JSON.stringify({ path: f.path_lower }),
                },
            });
            if (!dRes.ok) return null;
            try {
                const rec = JSON.parse(await dRes.text());
                return { ...rec, driveFileId: f.path_lower };
            } catch { return null; }
        }));
        // A file we could not read leaves the listing partial — the caller must
        // not treat drawings missing from it as remotely deleted.
        if (results.some((r) => r === null)) incomplete = true;
        out.push(...results.filter(Boolean));
    }

    return {
        drawings: out
            .filter((d) => d.deviceId === deviceId)
            .sort((a, b) => a.timestamp - b.timestamp),
        incomplete,
    };
}

export async function deleteDrawing(path) {
    const token = await _token();
    const res = await fetch(`${RPC_API}/files/delete_v2`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
    });
    // 409 = path not found; treat as already deleted.
    if (!res.ok && res.status !== 409)
        throw new Error(`Dropbox delete failed: ${res.status} ${await res.text()}`);
}

export async function isConnected() {
    try { return await isDropboxConnected(); } catch { return false; }
}
