// W7 — IndexedDB CRUD for drawings and device configs.
//
// Schema:
//   DB name:    'pandaink'
//   Version:    1
//   Stores:
//     'drawings'  — keyPath: 'id' (auto-increment)
//                   index 'by_device' on 'deviceId'
//     'devices'   — keyPath: 'id' (the Web Bluetooth device.id)
//
// Drawing record:
//   { id?, deviceId, timestamp, dimensions, strokes }
//   strokes: array of arrays of { x, y, p }
//
// Device record:
//   { id, name, uuid, protocol }

const DB_NAME    = 'pandaink';
const DB_VERSION = 1;

let _db = null;

function openDb() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('drawings')) {
                const drawingStore = db.createObjectStore('drawings', {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                drawingStore.createIndex('by_device', 'deviceId', { unique: false });
            }

            if (!db.objectStoreNames.contains('devices')) {
                db.createObjectStore('devices', { keyPath: 'id' });
            }
        };

        req.onsuccess = (event) => {
            _db = event.target.result;
            resolve(_db);
        };

        req.onerror = () => reject(req.error);
    });
}

function tx(storeName, mode, fn) {
    return openDb().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const req = fn(store);
            transaction.oncomplete = () => resolve(req ? req.result : undefined);
            transaction.onerror   = () => reject(transaction.error);
            transaction.onabort   = () => reject(transaction.error);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawings
// ─────────────────────────────────────────────────────────────────────────────

/** Save a drawing record. Returns the auto-assigned id. */
export function saveDrawing(drawing) {
    return tx('drawings', 'readwrite', (store) => store.add(drawing));
}

/** Retrieve all drawings for a specific device, ordered by timestamp ascending. */
export function getDrawingsByDevice(deviceId) {
    return openDb().then((db) => {
        return new Promise((resolve, reject) => {
            const t     = db.transaction('drawings', 'readonly');
            const store = t.objectStore('drawings');
            const idx   = store.index('by_device');
            const req   = idx.getAll(IDBKeyRange.only(deviceId));
            req.onsuccess = () => {
                const rows = req.result.sort((a, b) => a.timestamp - b.timestamp);
                resolve(rows);
            };
            req.onerror = () => reject(req.error);
        });
    });
}

/** Retrieve a single drawing by its auto-increment id. */
export function getDrawing(id) {
    return tx('drawings', 'readonly', (store) => store.get(id));
}

/** Delete a drawing by id. */
export function deleteDrawing(id) {
    return tx('drawings', 'readwrite', (store) => store.delete(id));
}

/** Delete all drawings for a device. */
export function deleteDrawingsByDevice(deviceId) {
    return openDb().then((db) => {
        return new Promise((resolve, reject) => {
            const t     = db.transaction('drawings', 'readwrite');
            const store = t.objectStore('drawings');
            const idx   = store.index('by_device');
            const req   = idx.openCursor(IDBKeyRange.only(deviceId));
            req.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            t.oncomplete = () => resolve();
            t.onerror    = () => reject(t.error);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Devices
// ─────────────────────────────────────────────────────────────────────────────

/** Save or update a device record (upsert by id). */
export function saveDevice(device) {
    return tx('devices', 'readwrite', (store) => store.put(device));
}

/** Retrieve a device record by Web Bluetooth device.id. */
export function getDevice(id) {
    return tx('devices', 'readonly', (store) => store.get(id));
}

/** Retrieve all stored devices. */
export function getAllDevices() {
    return tx('devices', 'readonly', (store) => store.getAll());
}

/** Delete a device and all its drawings. */
export async function deleteDevice(id) {
    await deleteDrawingsByDevice(id);
    return tx('devices', 'readwrite', (store) => store.delete(id));
}
