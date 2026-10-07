// Local-only: direct API rejections for Delete User must change nothing (no data change, no ban left behind),
// and a deleted account must no longer be able to sign in. Requires loopback URL + process-only local keys.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !anonKey || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error("Requires an explicit loopback Supabase URL and process-only local keys.");
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
async function create(name, role) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "LocalTest123!", email_confirm: true, user_metadata: { display_name: name } });
  assert.ifError(error);
  assert.ifError((await admin.from("profiles").update({ role, display_name: name }).eq("id", data.user.id)).error);
  return { id: data.user.id, email, name, password: "LocalTest123!" };
}
const actor = await create("Reject Admin", "admin");
const otherAdmin = await create("Reject Other Admin", "admin");
const target = await create("Reject Target", "user");
const login = await createClient(url, anonKey).auth.signInWithPassword({ email: actor.email, password: actor.password });
assert.ifError(login.error);
const call = (body) => fetch(`${url}/functions/v1/delete-user`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${login.data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const snapshot = async (ids) => {
  const rows = (await admin.from("profiles").select("*").in("id", ids)).data;
  const bans = await Promise.all(ids.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user?.banned_until ?? null));
  const logs = (await admin.from("activity_logs").select("id", { count: "exact", head: true })).count;
  return JSON.stringify({ rows, bans, logs });
};
const ids = [actor.id, otherAdmin.id, target.id];
const before = await snapshot(ids);
const results = {};
const dummy = { confirmName: "x", cutoffDate: "2000-01-01", futureCount: 0, futureDayoffCount: 0, retainedCount: 0 };
results.deleteSelf = await call({ action: "delete", targetId: actor.id, ...dummy });
results.deleteAdmin = await call({ action: "delete", targetId: otherAdmin.id, ...dummy });
results.deleteMissing = await call({ action: "delete", targetId: crypto.randomUUID(), ...dummy });
results.wrongName = await call({ action: "delete", targetId: target.id, ...dummy });
assert.equal(results.deleteSelf.status, 400); assert.equal(results.deleteSelf.body.code, "SELF_DELETE");
assert.equal(results.deleteAdmin.status, 400); assert.equal(results.deleteAdmin.body.code, "ROLE_FORBIDDEN");
assert.equal(results.deleteMissing.status, 404);
assert.equal(results.wrongName.status, 400); assert.equal(results.wrongName.body.code, "NAME_MISMATCH");
assert.equal(await snapshot(ids), before, "rejections must not change data, ban state or logs");

// delete the target for real, then confirm it can no longer sign in
const preview = (await call({ action: "preview", targetId: target.id })).body;
const done = await call({ action: "delete", targetId: target.id, confirmName: target.name, cutoffDate: preview.cutoffDate, futureCount: preview.futureCount, futureDayoffCount: preview.futureDayoffCount, retainedCount: preview.retainedCount });
assert.equal(done.status, 200);
const relogin = await createClient(url, anonKey).auth.signInWithPassword({ email: target.email, password: target.password });
assert.ok(relogin.error, "deleted account must not sign in");
assert.equal((await admin.from("profiles").select("id").eq("id", target.id).maybeSingle()).data, null);

console.log(JSON.stringify({ loopback: true, statuses: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, `${v.status}${v.body.code ? " " + v.body.code : ""}`])), noChangeAfterRejections: true, deletedAccountSignInRejected: relogin.error.message }, null, 2));
