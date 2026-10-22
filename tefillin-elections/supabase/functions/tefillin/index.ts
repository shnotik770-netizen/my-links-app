// Edge Function "tefillin" – the only entry point to the tefillin_* tables.
// The website calls this URL without any Supabase key; the service-role key stays on the server,
// and the function can only call the tefillin_* database functions listed below.
// Deployed with verify_jwt = false (public endpoint; admin actions check the admin password).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

// action -> [database function, request fields passed as p_<snake_case>]
const RPC: Record<string, [string, string[]]> = {
  getPublic: ["tefillin_get_public", []],
  signup: ["tefillin_signup", ["stationId", "slot", "name", "phone"]],
  login: ["tefillin_login", ["password"]],
  getAdmin: ["tefillin_get_admin", ["password"]],
  saveStation: ["tefillin_save_station", ["password", "station"]],
  adminSetSlot: ["tefillin_admin_set_slot", ["password", "stationId", "slot", "name", "phone"]],
  adminSetSeat: ["tefillin_admin_set_seat", ["password", "stationId", "slot", "seat", "name", "phone"]],
  changePassword: ["tefillin_change_password", ["password", "newPassword"]],
  saveTicker: ["tefillin_save_ticker", ["password", "lines"]],
  setSlotsAll: ["tefillin_set_slots_all", ["password", "add", "remove"]],
};

// action -> table whose row (by id) an admin may delete
const DELETE: Record<string, [string, string]> = {
  deleteStation: ["tefillin_stations", "הקלפי לא נמצאה"], // signups cascade
  cancelSignup: ["tefillin_signups", "ההרשמה לא נמצאה"],
};

class UserError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

function snake(key: string) {
  return "p_" + key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
  const data = await res.json().catch(() => null);
  if (res.ok) return data ?? {};
  // P0001 = "raise exception" in our functions: a Hebrew message meant for the user.
  if (data?.code === "P0001") throw new UserError(data.message);
  if (data?.code === "22P02") throw new UserError("בקשה לא תקינה");
  console.error(fn, res.status, data);
  throw new Error("server");
}

async function remove(table: string, id: unknown, notFound: string) {
  if (typeof id !== "string" || !UUID.test(id)) throw new UserError("בקשה לא תקינה");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!res.ok) {
    console.error(table, res.status, await res.text());
    throw new Error("server");
  }
  if (!(await res.json()).length) throw new UserError(notFound);
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, error: "Method not allowed" }, 405);

  try {
    const text = await req.text();
    if (text.length > 10_000) throw new UserError("בקשה לא תקינה");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text || "{}");
    } catch {
      throw new UserError("בקשה לא תקינה");
    }
    const action = String(body.action || "");

    if (DELETE[action]) {
      const [table, notFound] = DELETE[action];
      await rpc("tefillin_login", { p_password: body.password ?? null });
      await remove(table, body.id, notFound);
      return reply({ ok: true });
    }

    const route = RPC[action];
    if (!route) throw new UserError("פעולה לא מוכרת");
    const [fn, fields] = route;
    const args = Object.fromEntries(fields.map((f) => [snake(f), body[f] ?? null]));
    const result = await rpc(fn, args);
    return reply({ ok: true, ...result });
  } catch (err) {
    if (err instanceof UserError) return reply({ ok: false, error: err.message });
    return reply({ ok: false, error: "שגיאת שרת, נסו שוב בעוד רגע" }, 500);
  }
});
