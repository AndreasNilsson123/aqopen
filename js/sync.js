/**
 * sync.js – server synchronisation and local-storage persistence.
 */
import { HOLES } from './constants.js';
import { clone, same } from './utils.js';
import { migrateState } from './state.js';
import { canEdit, store, setCourses } from './store.js';

const API       = '/api/state';
const LOCAL_KEY = 'aqopen-state-v2';
const POLL_MS   = 6000;

function timeLabel(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function setStatus(txt, strong) {
  document.getElementById('status').innerHTML = strong ? '<b>' + txt + '</b>' : txt;
}

export function syncedNote() {
  if (store.local.spectator) return 'Visningsläge · den här enheten kan inte ändra resultat';
  if (store.authRequired && !store.local.editKey.trim()) return 'Lägg in redigeringsnyckeln under Inställningar för att kunna ändra resultat';
  if (!store.offline) return 'Sparat' + (store.lastSyncedAt ? ' · senast ' + timeLabel(store.lastSyncedAt) : '') + ' · alla som öppnar sidan ser samma resultat';
  return 'Servern svarar inte' + (store.lastError ? ' (' + store.lastError + ')' : '') + ' · sparat på den här telefonen så länge';
}

function requestHeaders(extra = {}) {
  const headers = { ...extra };
  const key = store.local.editKey.trim();
  if (key) headers['x-aqopen-key'] = key;
  return headers;
}

async function responseError(r, fallback) {
  try {
    const data = await r.json();
    if (typeof data?.error === 'string' && data.error) return data.error;
  } catch {}
  return fallback;
}

/* ---------- three-way merge ---------- */
function merge(base, local, server) {
  if (base === undefined) base = null;
  if (same(local, server)) return clone(local);

  if (Array.isArray(local) && Array.isArray(server)) {
    if (Array.isArray(base) && local.length === server.length && base.length === local.length) {
      return local.map((v, i) => merge(base[i], v, server[i]));
    }
    return same(local, base) ? clone(server) : clone(local);
  }

  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  if (plain(local) && plain(server)) {
    const out = {};
    const b   = plain(base) ? base : {};
    new Set([...Object.keys(local), ...Object.keys(server)]).forEach(k => {
      const inL = k in local, inS = k in server, inB = k in b;
      if (inL && inS)       out[k] = merge(b[k], local[k], server[k]);
      else if (inL) { if (!inB || !same(local[k], b[k])) out[k] = clone(local[k]); }
      else if (inS) { if (!inB) out[k] = clone(server[k]); }
    });
    return out;
  }
  return same(local, base) ? clone(server) : clone(local);
}

export function applyServer(doc) {
  const incoming = doc.state ? migrateState(doc.state) : null;
  store.authRequired = !!doc.protected;
  store.lastSyncedAt = doc.updated || store.lastSyncedAt;
  if (!incoming) { store.rev = doc.rev; store.base = clone(store.S); return false; }
  const merged  = store.base ? migrateState(merge(store.base, store.S, incoming)) : incoming;
  const changed = !same(merged, store.S);
  store.S    = merged;
  store.base = clone(incoming);
  store.rev  = doc.rev;
  if (!same(store.S, incoming)) queueSave();
  return changed;
}

/* ---------- network ---------- */
async function pull() {
  const r = await fetch(API, { cache: 'no-store', headers: requestHeaders() });
  if (!r.ok) throw new Error(await responseError(r, 'GET ' + r.status));
  store.lastError = '';
  return r.json();
}

async function push() {
  const r = await fetch(API, {
    method:  'PUT',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ rev: store.rev, state: store.S })
  });
  if (r.status === 409) {
    try {
      return { conflict: true, doc: await r.json() };
    } catch {
      throw new Error('PUT 409');
    }
  }
  if (!r.ok)            throw new Error(await responseError(r, 'PUT ' + r.status));
  return { conflict: false, doc: await r.json() };
}

/* ---------- save pipeline ---------- */

/** Flush queued changes to the server and localStorage. */
async function flush() {
  store.saveTimer = null;
  if (store.inFlight) { store.dirty = true; return; }
  store.inFlight = true;
  store.dirty    = false;
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ rev: store.rev, state: store.S }));
  try {
    let res = await push();
    if (res.conflict) {
      applyServer(res.doc);
      res = await push();
      if (res.conflict) store.dirty = true;
    }
    if (!res.conflict) {
      store.rev = res.doc.rev;
      store.base = clone(store.S);
      store.lastSyncedAt = res.doc.updated || store.lastSyncedAt;
      store.authRequired = !!res.doc.protected;
    }
    store.offline = false;
    setStatus(syncedNote());
    // Trigger a re-render via the app module (imported lazily to avoid cycles).
    import('./app.js').then(m => m.render());
  } catch (e) {
    store.offline   = true;
    store.lastError = e.message;
    setStatus(syncedNote());
  } finally {
    store.inFlight = false;
    if (store.dirty) queueSave();
  }
}

export function queueSave() {
  if (!canEdit()) {
    setStatus(syncedNote(), true);
    return;
  }
  clearTimeout(store.saveTimer);
  if (!store.offline) setStatus('Sparar…');
  store.saveTimer = setTimeout(flush, 500);
}

/** Alias used throughout UI modules. */
export const save = queueSave;

/* ---------- polling ---------- */
export async function poll() {
  if (store.inFlight || store.saveTimer) return;
  try {
    const doc = await pull();
    store.offline = false;
    store.authRequired = !!doc.protected;
    store.lastSyncedAt = doc.updated || store.lastSyncedAt;
    if (doc.rev !== store.rev) {
      const changed = applyServer(doc);
      setStatus(syncedNote());
      if (changed) import('./app.js').then(m => m.render());
    }
  } catch (e) {
    if (!store.offline) {
      store.offline   = true;
      store.lastError = e.message;
      setStatus(syncedNote());
    }
  }
}

/* ---------- initial load ---------- */
export async function load() {
  // Load course library.
  try {
    const r = await fetch('courses.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (Array.isArray(d.courses) && d.courses.length) {
      setCourses(d.courses.filter(c => Array.isArray(c.pars) && c.pars.length === HOLES));
    }
  } catch (_) {}

  // Restore from localStorage if present.
  const cached = localStorage.getItem(LOCAL_KEY) || localStorage.getItem('aqopen-state-v1');
  if (cached) {
    try {
      const c  = JSON.parse(cached);
      store.S   = migrateState(c.state || {});
      store.rev = c.rev || 0;
      store.base = clone(store.S);
    } catch (_) {}
  }

  // Sync from server.
  try {
    const doc = await pull();
    applyServer(doc);
    if (!doc.state) queueSave();
    setStatus(syncedNote());
  } catch (e) {
    store.offline   = true;
    store.lastError = e.message;
    setStatus(syncedNote());
  }

  const { render } = await import('./app.js');
  render();

  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
