import { getStore } from "@netlify/blobs";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function whoami(req) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  let r = null;
  for (const path of ["/api/me", "/.netlify/functions/api/me"]) {
    try { r = await fetch(new URL(path, req.url), { headers: { Authorization: auth } }); } catch (e) { r = null; }
    if (r && r.status === 404 && !(r.headers.get("content-type") || "").includes("json")) continue;
    break;
  }
  if (!r || !r.ok) return null;
  const me = await r.json().catch(() => null);
  if (!me || !me.id || me.blocked || me.active === false) return null;
  return me;
}

export default async (req) => {
  const me = await whoami(req);
  if (!me) return json(401, { error: "Sign in to the Team Portal first.", code: "signin" });

  // Strong consistency avoids a stale read immediately after a Leads save/migration.
  const store = getStore("northfield-portal-data", { consistency: "strong" });
  const key = "manufacturer-leads";

  if (req.method === "GET") {
    const leads = await store.get(key, { type: "json" });
    return json(200, { exists: leads !== null, leads: Array.isArray(leads) ? leads : [] });
  }

  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.leads))
      return json(400, { error: "Leads must be an array.", code: "input" });

    // Migration can only seed an empty store, so a second browser can never overwrite the first migration.
    if (body.migrateOnlyIfEmpty) {
      const existing = await store.get(key, { type: "json" });
      if (existing !== null)
        return json(200, { ok: true, migrated: false, leads: Array.isArray(existing) ? existing : [] });
    }

    await store.setJSON(key, body.leads);
    return json(200, { ok: true, count: body.leads.length });
  }

  return json(405, { error: "Method not allowed.", code: "input" });
};
