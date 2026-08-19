import { getStore } from "@netlify/blobs";

// Shared scorecard for AqOpen.
// GET  /api/state -> { rev, state }
// PUT  /api/state { rev, state } -> { rev }  (409 { rev, state } if rev is stale)
//
// Optimistic concurrency: a write only lands if it carries the revision the
// client last read. A stale write gets the current document back so the
// client can merge and retry, which stops one phone overwriting another.
//
// GET  /api/history            -> { events: [...] }
// POST /api/history { name, date, state } -> { ok: true }
// DELETE /api/history?index=N  -> { ok: true }
//
// GET  /api/audit              -> { entries: [...] }  (edit-key protected)

const KEY       = "state";
const HIST_KEY  = "history";
const AUDIT_KEY = "audit";
const MAX_AUDIT = 500;
const MAX_HIST  = 50;

const EDIT_KEY = process.env.AQOPEN_KEY?.trim() || "";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

function blobs() {
  // Strong consistency: a read straight after a write must see the write.
  return getStore({ name: "aqopen", consistency: "strong" });
}

function canWrite(req) {
  if (!EDIT_KEY) return true;
  return req.headers.get("x-aqopen-key") === EDIT_KEY;
}

/** Compute a simple non-cryptographic hash of the edit key so we can tell
 *  callers apart in the audit log without storing the raw key. */
async function keyHash(key) {
  if (!key) return "anon";
  try {
    const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const arr  = Array.from(new Uint8Array(buf));
    return arr.slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "unknown";
  }
}

/** Append one audit entry and cap the log at MAX_AUDIT entries. */
async function appendAudit(store, entry) {
  try {
    const current = (await store.get(AUDIT_KEY, { type: "json" })) ?? { entries: [] };
    const entries = Array.isArray(current.entries) ? current.entries : [];
    entries.push(entry);
    if (entries.length > MAX_AUDIT) entries.splice(0, entries.length - MAX_AUDIT);
    await store.setJSON(AUDIT_KEY, { entries });
  } catch {
    // Audit failure must never break a real write.
  }
}

/* ------------------------------------------------------------------ */
/* /api/state                                                           */
/* ------------------------------------------------------------------ */
async function handleState(req, store) {
  if (req.method === "GET") {
    const doc = await store.get(KEY, { type: "json" });
    return json({
      rev: doc?.rev ?? 0,
      state: doc?.state ?? null,
      updated: doc?.updated ?? null,
      protected: !!EDIT_KEY,
    });
  }

  if (req.method === "PUT") {
    if (!canWrite(req)) {
      return json({ error: "Edit key required to change scores." }, 403);
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }
    if (typeof body?.rev !== "number" || typeof body?.state !== "object" || body.state === null) {
      return json({ error: "Send { rev: number, state: object }." }, 400);
    }

    const current = (await store.get(KEY, { type: "json" })) ?? { rev: 0, state: null };
    if (body.rev !== current.rev) {
      return json({
        conflict: true,
        rev: current.rev,
        state: current.state,
        updated: current.updated ?? null,
        protected: !!EDIT_KEY,
      }, 409);
    }

    const next = {
      rev: current.rev + 1,
      state: body.state,
      updated: new Date().toISOString(),
    };
    await store.setJSON(KEY, next);

    // Audit: detect which top-level keys changed.
    const changedKeys = [];
    if (current.state && typeof current.state === "object") {
      for (const k of new Set([...Object.keys(current.state), ...Object.keys(body.state)])) {
        if (JSON.stringify(current.state[k]) !== JSON.stringify(body.state[k])) {
          changedKeys.push(k);
        }
      }
    } else {
      changedKeys.push("(initial)");
    }
    const hash = await keyHash(req.headers.get("x-aqopen-key") || "");
    await appendAudit(store, {
      at: next.updated,
      rev: next.rev,
      changedKeys,
      callerHash: hash,
    });

    return json({ rev: next.rev, updated: next.updated, protected: !!EDIT_KEY });
  }

  if (req.method === "DELETE") {
    if (!canWrite(req)) {
      return json({ error: "Edit key required to reset scores." }, 403);
    }
    await store.delete(KEY);
    const hash = await keyHash(req.headers.get("x-aqopen-key") || "");
    await appendAudit(store, {
      at: new Date().toISOString(),
      rev: 0,
      changedKeys: ["(reset)"],
      callerHash: hash,
    });
    return json({ rev: 0, state: null, updated: null, protected: !!EDIT_KEY });
  }

  return json({ error: "Use GET, PUT or DELETE." }, 405);
}

/* ------------------------------------------------------------------ */
/* /api/history                                                         */
/* ------------------------------------------------------------------ */
async function handleHistory(req, store) {
  if (req.method === "GET") {
    const doc = await store.get(HIST_KEY, { type: "json" });
    const events = Array.isArray(doc?.events) ? doc.events : [];
    // Strip full state from list response to keep it small.
    return json({ events: events.map(({ state: _s, ...rest }) => rest) });
  }

  if (!canWrite(req)) {
    return json({ error: "Edit key required." }, 403);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
    if (typeof body?.state !== "object" || body.state === null) {
      return json({ error: "Send { name, date, state }." }, 400);
    }
    const doc    = (await store.get(HIST_KEY, { type: "json" })) ?? { events: [] };
    const events = Array.isArray(doc.events) ? doc.events : [];
    events.push({
      id:         Date.now().toString(36),
      name:       String(body.name || "Unnamed event").slice(0, 120),
      date:       String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 32),
      archivedAt: new Date().toISOString(),
      state:      body.state,
    });
    if (events.length > MAX_HIST) events.splice(0, events.length - MAX_HIST);
    await store.setJSON(HIST_KEY, { events });
    return json({ ok: true, count: events.length });
  }

  if (req.method === "DELETE") {
    const url   = new URL(req.url);
    const index = parseInt(url.searchParams.get("index") ?? "", 10);
    if (!Number.isFinite(index)) return json({ error: "Provide ?index=N." }, 400);
    const doc    = (await store.get(HIST_KEY, { type: "json" })) ?? { events: [] };
    const events = Array.isArray(doc.events) ? doc.events : [];
    if (index < 0 || index >= events.length) return json({ error: "Index out of range." }, 400);
    events.splice(index, 1);
    await store.setJSON(HIST_KEY, { events });
    return json({ ok: true, count: events.length });
  }

  return json({ error: "Use GET, POST or DELETE." }, 405);
}

/* ------------------------------------------------------------------ */
/* /api/history/:id  – fetch full state for one archived event         */
/* ------------------------------------------------------------------ */
async function handleHistoryItem(req, store, id) {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const doc    = await store.get(HIST_KEY, { type: "json" });
  const events = Array.isArray(doc?.events) ? doc.events : [];
  const evt    = events.find(e => e.id === id);
  if (!evt) return json({ error: "Not found." }, 404);
  return json(evt);
}

/* ------------------------------------------------------------------ */
/* /api/audit                                                           */
/* ------------------------------------------------------------------ */
async function handleAudit(req, store) {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  if (!canWrite(req)) return json({ error: "Edit key required to view audit log." }, 403);
  const url   = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), MAX_AUDIT);
  const doc   = (await store.get(AUDIT_KEY, { type: "json" })) ?? { entries: [] };
  const all   = Array.isArray(doc.entries) ? doc.entries : [];
  return json({ entries: all.slice(-limit).reverse(), total: all.length });
}

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */
export default async (req) => {
  const url  = new URL(req.url);
  const path = url.pathname;
  const store = blobs();

  if (path === "/api/state")   return handleState(req, store);
  if (path === "/api/history") return handleHistory(req, store);
  if (path === "/api/audit")   return handleAudit(req, store);

  const histMatch = path.match(/^\/api\/history\/([a-z0-9]+)$/);
  if (histMatch) return handleHistoryItem(req, store, histMatch[1]);

  return json({ error: "Unknown endpoint." }, 404);
};

export const config = { path: ["/api/state", "/api/history", "/api/history/:id", "/api/audit"] };
