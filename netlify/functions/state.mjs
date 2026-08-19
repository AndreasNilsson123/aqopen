import { getStore } from "@netlify/blobs";

// Shared scorecard for AqOpen.
// GET  /api/state -> { rev, state }
// PUT  /api/state { rev, state } -> { rev }  (409 { rev, state } if rev is stale)
//
// Optimistic concurrency: a write only lands if it carries the revision the
// client last read. A stale write gets the current document back so the
// client can merge and retry, which stops one phone overwriting another.

const KEY = "state";
const EDIT_KEY = process.env.AQOPEN_KEY?.trim() || "";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

function store() {
  // Strong consistency: a read straight after a write must see the write.
  return getStore({ name: "aqopen", consistency: "strong" });
}

function canWrite(req) {
  if (!EDIT_KEY) return true;
  return req.headers.get("x-aqopen-key") === EDIT_KEY;
}

export default async (req) => {
  const blobs = store();

  if (req.method === "GET") {
    const doc = await blobs.get(KEY, { type: "json" });
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

    const current = (await blobs.get(KEY, { type: "json" })) ?? { rev: 0, state: null };
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
    await blobs.setJSON(KEY, next);
    return json({ rev: next.rev, updated: next.updated, protected: !!EDIT_KEY });
  }

  if (req.method === "DELETE") {
    if (!canWrite(req)) {
      return json({ error: "Edit key required to reset scores." }, 403);
    }
    await blobs.delete(KEY);
    return json({ rev: 0, state: null, updated: null, protected: !!EDIT_KEY });
  }

  return json({ error: "Use GET, PUT or DELETE." }, 405);
};

export const config = { path: "/api/state" };
