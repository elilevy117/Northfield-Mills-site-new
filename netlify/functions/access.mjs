// Northfield Mills Team Portal: per-person access + sign-in status.
//   GET  /.netlify/functions/access                  -> { people: { <userId>: {areas, status, firstSeen, lastSeen} }, me }
//   POST /.netlify/functions/access  {seen:true}      -> records that the caller signed in (anyone signed in)
//   PUT  /.netlify/functions/access  {id, areas?, status?}  -> admins only
// Who is calling (and whether they're an admin) comes from the portal's own /api/me.
// Data lives in Netlify Blobs (store "northfield-access"), one entry per person.
import { getStore } from "@netlify/blobs";

const AREAS = ["tickets", "conversations", "leads", "gmail", "emails"];
const STATUSES = ["auto", "leave"];
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function whoami(req) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  let r = null;
  // the portal API is usually at /api/me; some setups only expose /.netlify/functions/api/me
  for (const path of ["/api/me", "/.netlify/functions/api/me"]) {
    try { r = await fetch(new URL(path, req.url), { headers: { Authorization: auth } }); } catch (e) { r = null; }
    if (r && r.status === 404 && !(r.headers.get("content-type") || "").includes("json")) continue;
    break;
  }
  if (!r || !r.ok) return null;
  const me = await r.json().catch(() => null);
  if (!me || !me.id || me.blocked || me.active === false) return null;
  const role = String(me.role || "").trim().toLowerCase();
  const list = Array.isArray(me.roles) ? me.roles.map(x => String(x).toLowerCase()) : [];
  me.isAdmin = ["admin", "owner", "administrator"].includes(role) || me.isAdmin === true || list.includes("admin") || list.includes("owner");
  return me;
}

const key = id => "p/" + encodeURIComponent(String(id));

export default async (req) => {
  const me = await whoami(req);
  if (!me) return json(401, { error: "Sign in to the Team Portal first.", code: "signin" });
  const store = getStore("northfield-access");

  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "p/" });
    const people = {};
    await Promise.all(blobs.map(async b => {
      const v = await store.get(b.key, { type: "json" });
      if (v) people[decodeURIComponent(b.key.slice(2))] = v;
    }));
    return json(200, { people, me: me.id });
  }

  const body = await req.json().catch(() => ({}));

  if (req.method === "POST" && body.seen) {
    const cur = (await store.get(key(me.id), { type: "json" })) || {};
    const now = new Date().toISOString();
    cur.lastSeen = now; if (!cur.firstSeen) cur.firstSeen = now;
    await store.setJSON(key(me.id), cur);
    return json(200, { ok: true, person: cur });
  }

  if (req.method === "PUT") {
    if (!me.isAdmin) return json(403, { error: "Only admins can change access.", code: "forbidden" });
    const id = String(body.id || "");
    if (!id || id.length > 200) return json(400, { error: "Missing person.", code: "input" });
    const cur = (await store.get(key(id), { type: "json" })) || {};
    if (Array.isArray(body.areas)) cur.areas = [...new Set(body.areas.filter(a => AREAS.includes(a)))];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return json(400, { error: "Unknown status.", code: "input" });
      cur.status = body.status;
    }
    cur.updatedBy = me.id; cur.updatedAt = new Date().toISOString();
    await store.setJSON(key(id), cur);
    return json(200, { ok: true, person: cur });
  }

  return json(405, { error: "Method not allowed.", code: "input" });
};
