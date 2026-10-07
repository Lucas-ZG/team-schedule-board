// Round-3 verification (local stack only): R3-M2 reserved delete-user Logs event cannot be written by anon/authenticated.
// Real user / viewer JWTs over REST under unchanged table privileges and RLS.
// Never prints keys.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { handleDeleteUser } from "../supabase/functions/delete-user/handler.ts";

const url = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !anonKey || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error("Requires an explicit loopback Supabase URL and process-only local keys.");
}
const authOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, authOpts);
const stamp = Date.now();
const md5 = (value) => crypto.createHash("md5").update(JSON.stringify(value)).digest("hex");
async function create(name, role) {
  const mail = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@local.test`;
  const { data, error } = await svc.auth.admin.createUser({ email: mail, password: "LocalTest123!", email_confirm: true, user_metadata: { display_name: name } });
  assert.ifError(error);
  assert.ifError((await svc.from("profiles").update({ role, display_name: name }).eq("id", data.user.id)).error);
  const session = (await createClient(url, anonKey, authOpts).auth.signInWithPassword({ email: mail, password: "LocalTest123!" })).data.session;
  const rest = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${session.access_token}` } }, ...authOpts });
  return { id: data.user.id, name, rest };
}
const reservedRow = (userId, actorName) => ({ user_id: userId, event_type: "delete", target_table: "profiles", target_id: crypto.randomUUID(), detail: { action: "delete_user", actor_name: actorName, target_name: "Forged Victim" } });
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, "PASS"]); console.log(`PASS ${name}`); }
  catch (error) { results.push([name, "FAIL"]); console.log(`FAIL ${name}: ${String(error.message).split("\n").slice(0, 10).join(" | ")}`); }
}

// legacy-looking rows (incl. a NULL user_id) so that the "existing Logs unchanged" check has something to compare
assert.ifError((await svc.from("activity_logs").insert([
  { user_id: null, event_type: "login", detail: { legacy: true } },
  { user_id: null, event_type: "update", target_table: "daily_status", detail: { legacy: true, before: {}, after: {} } },
  { user_id: null, event_type: "delete", target_table: "daily_status", detail: { legacy: true } },
])).error);
const preexisting = (await svc.from("activity_logs").select("*").order("id")).data;
const preexistingIds = new Set(preexisting.map((r) => r.id));
const preHash = md5(preexisting);
const admin = await create("R3 Admin", "admin");
const user = await create("R3 User", "user");
const viewer = await create("R3 Viewer", "viewer");

const forgedExists = async (actorName) => (await svc.from("activity_logs").select("id").eq("target_table", "profiles").eq("event_type", "delete").contains("detail", { actor_name: actorName })).data.length;

await check("R3-M2 (a) user and viewer JWTs cannot INSERT a reserved delete-user event", async () => {
  for (const who of [user, viewer]) {
    const actorName = `Forged by ${who.name}`;
    const r = await who.rest.from("activity_logs").insert(reservedRow(who.id, actorName));
    assert.ok(r.error, `${who.name}: reserved INSERT must fail`);
    assert.match(String(r.error.message), /reserved_event_type/, `${who.name}: blocked by the reserved-event guard, got: ${r.error.message}`);
    assert.equal(await forgedExists(actorName), 0, `${who.name}: no row may exist`);
  }
});

await check("R3-M2 (a2) an ordinary client log row is still accepted (login / daily_status events)", async () => {
  for (const who of [user, viewer]) {
    const ok = await who.rest.from("activity_logs").insert([
      { user_id: who.id, event_type: "login", detail: { note: "r3 ordinary" } },
      { user_id: who.id, event_type: "delete", target_table: "daily_status", target_id: crypto.randomUUID(), detail: { deleted: { work_date: "2026-01-01" } } },
    ]);
    assert.ifError(ok.error);
  }
});

await check("R3-M2 (b) user and viewer cannot turn their own existing row into the reserved type", async () => {
  for (const who of [user, viewer]) {
    const own = (await svc.from("activity_logs").select("*").eq("user_id", who.id).eq("event_type", "login").limit(1).single()).data;
    const actorName = `Upgraded by ${who.name}`;
    const r = await who.rest.from("activity_logs").update({ event_type: "delete", target_table: "profiles", detail: { action: "delete_user", actor_name: actorName } }).eq("id", own.id).select();
    console.log(JSON.stringify({ role: who.name, operation: "REST UPDATE", httpStatus: r.status, code: r.error?.code ?? null, message: r.error?.message ?? "No rows returned", returnedRows: r.data?.length ?? 0 }));
    // authenticated has no UPDATE policy on activity_logs (RLS), so PostgREST answers with 0 rows or an error; either way nothing changes.
    assert.ok(r.error || (r.data || []).length === 0, `${who.name}: UPDATE must not touch a row`);
    const after = (await svc.from("activity_logs").select("*").eq("id", own.id).single()).data;
    assert.deepEqual(after, own, `${who.name}: row unchanged`);
    assert.equal(await forgedExists(actorName), 0);
  }
  console.log("   note: REST-only UPDATE verification; existing privileges/RLS block the write. No independent trigger UPDATE claim.");
});

await check("R3-M2 (d) the real delete-user flow still writes the reserved event with actor and target names", async () => {
  const victim = await create("R3 Victim", "user");
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${(await createClient(url, anonKey, authOpts).auth.signInWithPassword({ email: `r3-admin-${stamp}@local.test`, password: "LocalTest123!" })).data.session.access_token}` } }, ...authOpts });
  const p = (await handleDeleteUser(callerClient, svc, { action: "preview", targetId: victim.id })).body;
  const r = await handleDeleteUser(callerClient, svc, { action: "delete", targetId: victim.id, confirmName: p.confirmName, cutoffDate: p.cutoffDate, futureCount: p.futureCount, futureDayoffCount: p.futureDayoffCount, retainedCount: p.retainedCount });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ev = (await svc.from("activity_logs").select("*").eq("event_type", "delete").eq("target_table", "profiles").eq("target_id", victim.id)).data;
  assert.equal(ev.length, 1); assert.equal(ev[0].user_id, admin.id);
  assert.equal(ev[0].detail.action, "delete_user"); assert.equal(ev[0].detail.actor_name, "R3 Admin"); assert.equal(ev[0].detail.target_name, "R3 Victim");
});

await check("R3-M2 (e) every pre-existing Logs row is byte-identical after the whole run", async () => {
  const after = (await svc.from("activity_logs").select("*").order("id")).data.filter((r) => preexistingIds.has(r.id));
  assert.equal(after.length, preexisting.length);
  assert.equal(md5(after), preHash);
  console.log(`   pre-existing rows: ${preexisting.length}, md5 before == after: ${md5(after) === preHash}`);
});

const failed = results.filter(([, v]) => v === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} round-3 DB checks passed`);
process.exit(failed.length ? 1 : 0);
