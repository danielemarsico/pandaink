// Google Drive implementation of the cloud drawing store.
// All files live in the hidden appDataFolder (drive.appdata scope).
//
// File naming: drawing_<timestamp>.json
// Each file contains one drawing record: { deviceId, timestamp, dimensions, strokes }

import { getValidAccessToken } from '../auth/storage_oauth.js';

const DRIVE_API  = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function authHeaders() {
    const token = await getValidAccessToken();
    return { Authorization: 'Bearer ' + token };
}

// ── Internal helpers ────────────────────────────────────��─────────────────────

async function _listFiles(namePrefix = '') {
    const headers = await authHeaders();
    const q = namePrefix
        ? `name contains '${namePrefix}' and trashed = false`
        : 'trashed = false';
    const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'files(id,name)',
        q,
        pageSize: '1000',
    });
    const res = await fetch(`${DRIVE_API}/files?${params}`, { headers });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
    const { files } = await res.json();
    return files ?? [];
}

async function _download(fileId) {
    const headers = await authHeaders();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
    if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
    return res.json();
}

async function _upload(name, content) {
    const headers = await authHeaders();
    const metadata = JSON.stringify({ name, parents: ['appDataFolder'] });
    const body_    = JSON.stringify(content);

    const form = new FormData();
    form.append('metadata', new Blob([metadata], { type: 'application/json' }));
    form.append('file',     new Blob([body_],    { type: 'application/json' }));

    const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
        method:  'POST',
        headers,
        body:    form,
    });
    if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
    return res.json();   // { id, name }
}

async function _updateFile(fileId, content) {
    const headers = await authHeaders();
    const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
        method:  'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(content),
    });
    if (!res.ok) throw new Error(`Drive update failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function _deleteFile(fileId) {
    const headers = await authHeaders();
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404)
        throw new Error(`Drive delete failed: ${res.status}`);
}

// ── Public API ───────────────────��────────────────────────���───────────────────

/**
 * Upload one drawing. Returns the Drive file id stored in drawing.driveFileId.
 * Skips upload if a file with the same timestamp already exists (dedup).
 */
export async function saveDrawing(drawing) {
    const name = `drawing_${drawing.timestamp}.json`;
    const existing = await _listFiles(`drawing_${drawing.timestamp}`);
    if (existing.length > 0) {
        // Already uploaded — update in place
        await _updateFile(existing[0].id, drawing);
        return { ...drawing, driveFileId: existing[0].id };
    }
    const file = await _upload(name, drawing);
    return { ...drawing, driveFileId: file.id };
}

/**
 * Load all drawings for a device, sorted by timestamp ascending.
 * Each returned object has an extra driveFileId field for later deletion.
 */
export async function getDrawingsByDevice(deviceId) {
    const files = await _listFiles('drawing_');
    const drawings = [];
    // Download in parallel (max 6 at a time to avoid rate limits)
    const chunks = [];
    for (let i = 0; i < files.length; i += 6) chunks.push(files.slice(i, i + 6));
    for (const chunk of chunks) {
        const results = await Promise.all(chunk.map(f =>
            _download(f.id).then(d => ({ ...d, driveFileId: f.id })).catch(() => null)
        ));
        drawings.push(...results.filter(Boolean));
    }
    return drawings
        .filter(d => d.deviceId === deviceId)
        .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Delete a single drawing by its Drive file id.
 */
export async function deleteDrawing(driveFileId) {
    await _deleteFile(driveFileId);
}
