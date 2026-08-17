import { getStore } from "@netlify/blobs";

// Shared scorecard for AqOpen.
// GET  /api/state -> { rev, state }
// PUT  /api/state { rev, state } -> { rev }  (409 { rev, state } if rev is stale)
//
// Optimistic concurrency: a write only lands if it carries the revision the
// client last read. A stale write gets the current document back so the
// client can merge and retry, which stops one phone overwriting another.

const KEY = "state";
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

export default async (req) => {
  const blobs = store();

  if (req.method === "GET") {
    const doc = await blobs.get(KEY, { type: "json" });
    return json(doc ?? { rev: 0, state: null });
  }

  if (req.method === "PUT") {
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
      return json({ conflict: true, rev: current.rev, state: current.state }, 409);
    }

    const next = {
      rev: current.rev + 1,
      state: body.state,
      updated: new Date().toISOString(),
    };
    await blobs.setJSON(KEY, next);
    return json({ rev: next.rev });
  }

  if (req.method === "DELETE") {
    await blobs.delete(KEY);
    return json({ rev: 0, state: null });
  }

  return json({ error: "Use GET, PUT or DELETE." }, 405);
};

export const config = { path: "/api/state" };
