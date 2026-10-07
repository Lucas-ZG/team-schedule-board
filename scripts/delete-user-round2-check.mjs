// Round-2 verification (local stack only): M1 history guard via admin JWT over REST, M2 Auth lookup classification,
// M3 RPC outcome classification (response lost / committed or not), M5 >1000 rows, M6 multi-workplace dayoff count,
// stale cutoff (midnight rollover) and m2 empty display_name. Drives the real handler with real SDK clients against the
// local stack; fetch wrappers drop responses to simulate lost replies. Never prints keys.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { handleDeleteUser } from "../supabase/functions/delete-user/handler.ts";

const url = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !anonKey || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error("Requires an explicit loopback Supabase URL and process-only local keys.");
}
const authOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const adminClient = (fetchImpl) => createClient(url, serviceKey, { ...authOpts, ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}) });
const svc = adminClient();
function execSql(sql) {
  const run = spawnSync("docker", ["exec", "-i", "supabase_db_team_schedule", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`local SQL failed: ${run.stderr}`);
}
const stamp = Date.now();
async function create(name, role, email) {
  const mail = email || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@local.test`;
  const { data, error } = await svc.auth.admin.createUser({ email: mail, password: "LocalTest123!", email_confirm: true, user_metadata: { display_name: name } });
  assert.ifError(error);
  assert.ifError((await svc.from("profiles").update({ role, display_name: name }).eq("id", data.user.id)).error);
  return { id: data.user.id, email: mail, password: "LocalTest123!", name };
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const md5 = (value) => crypto.createHash("md5").update(JSON.stringify(value)).digest("hex");

const actor = await create("R2 Admin", "admin");
const k3 = (await svc.from("workplaces").select("id").eq("name", "K3").single()).data.id;
const dayoff = (await svc.from("workplaces").select("id").eq("is_dayoff", true).limit(1).single()).data.id;
const session = (await createClient(url, anonKey).auth.signInWithPassword({ email: actor.email, password: actor.password })).data.session;
const adminToken = session.access_token;
const callerClient = () => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${adminToken}` } }, ...authOpts });
const call = (body, client = svc) => handleDeleteUser(callerClient(), client, body);
const row = (userId, offset, ids = [k3], single = ids[0]) => ({ user_id: userId, work_date: addDays(today, offset), workplace_id: single, workplace_ids: ids });
async function previewOf(id, client = svc) { const r = await call({ action: "preview", targetId: id }, client); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }
const deleteBodyFor = (target, p, over = {}) => ({ action: "delete", targetId: target.id, confirmName: p.confirmName, cutoffDate: p.cutoffDate, futureCount: p.futureCount, futureDayoffCount: p.futureDayoffCount, retainedCount: p.retainedCount, ...over });
const authState = async (id) => { const r = await svc.auth.admin.getUserById(id); return r.error ? null : r.data.user; };
const banned = (u) => Boolean(u?.banned_until && new Date(u.banned_until) > new Date());

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, "PASS"]); console.log(`PASS ${name}`); }
  catch (error) { results.push([name, "FAIL"]); console.log(`FAIL ${name}: ${String(error.message).split("\n").slice(0, 14).join(" | ")}`); }
}

// ---------------- M1: deleted user's history rows cannot be rewritten, even by an admin JWT ----------------
await check("M1 deleted-user history is immutable via admin JWT over REST", async () => {
  const victim = await create("R2 Victim", "user"); const bystander = await create("R2 Bystander", "user"); const bystander2 = await create("R2 Bystander2", "user");
  assert.ifError((await svc.from("daily_status").insert([row(victim.id, -3), row(victim.id, -4), row(bystander.id, -3), row(victim.id, 2)])).error);
  assert.ifError((await svc.from("activity_logs").insert({ user_id: victim.id, event_type: "login", detail: { fixture: true } })).error);
  const p = await previewOf(victim.id);
  const deleted = await call(deleteBodyFor(victim, p)); assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  const snap = async () => ({
    victim: (await svc.from("daily_status").select("*").eq("user_id", victim.id).order("work_date")).data,
    bystander: (await svc.from("daily_status").select("*").eq("user_id", bystander.id).order("work_date")).data,
    logs: (await svc.from("activity_logs").select("*").eq("user_id", victim.id).order("id")).data,
  });
  const before = await snap(); assert.equal(before.victim.length, 2);
  const adminRest = callerClient(); // admin JWT; RLS lets admins write any daily_status row
  const victimRow = before.victim[0], bystanderRow = before.bystander[0];
  const attempts = {
    reassignVictimRowToOther: await adminRest.from("daily_status").update({ user_id: bystander2.id }).eq("id", victimRow.id).select(),
    editVictimRowOtherColumns: await adminRest.from("daily_status").update({ note: "tamper", leave_hours: 1 }).eq("id", victimRow.id).select(),
    deleteVictimRow: await adminRest.from("daily_status").delete().eq("id", victimRow.id).select(),
    reassignOthersRowToVictim: await adminRest.from("daily_status").update({ user_id: victim.id }).eq("id", bystanderRow.id).select(),
    insertForVictim: await adminRest.from("daily_status").insert(row(victim.id, -9)).select(),
  };
  for (const [name, r] of Object.entries(attempts)) {
    assert.ok(r.error, `${name} must be rejected`); assert.match(String(r.error.message), /deleted_user_read_only/, name);
  }
  const logUpdate = await svc.from("activity_logs").update({ detail: { tamper: true } }).eq("user_id", victim.id).select();
  const logDelete = await svc.from("activity_logs").delete().eq("user_id", victim.id).select();
  assert.ok(logUpdate.error && logDelete.error, "activity_logs of a deleted user must be read-only too");
  const after = await snap();
  assert.equal(md5(after.victim), md5(before.victim), "victim rows hash changed"); assert.equal(md5(after.bystander), md5(before.bystander), "bystander row changed");
  assert.equal(md5(after.logs), md5(before.logs), "victim logs changed");
});

// ---------------- M5: more than 1000 future rows ----------------
await check("M5 preview count is exact above the 1000-row API limit and delete succeeds", async () => {
  const big = await create("R2 Big", "user");
  const rows = [row(big.id, -2), row(big.id, 0)]; for (let i = 1; i <= 1200; i++) rows.push(row(big.id, i, i % 10 === 0 ? [dayoff] : [k3]));
  for (let i = 0; i < rows.length; i += 400) assert.ifError((await svc.from("daily_status").insert(rows.slice(i, i + 400))).error);
  const p = await previewOf(big.id);
  assert.deepEqual([p.futureCount, p.futureDayoffCount, p.retainedCount], [1200, 120, 2]);
  const sqlCounts = (await svc.rpc("delete_user_counts", { p_target_id: big.id, p_cutoff: null })).data;
  assert.deepEqual([sqlCounts.futureCount, sqlCounts.futureDayoffCount, sqlCounts.retainedCount], [1200, 120, 2], "preview and SQL must share one counting rule");
  const d = await call(deleteBodyFor(big, p)); assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal((await svc.from("daily_status").select("id", { count: "exact", head: true }).eq("user_id", big.id)).count, 2);
  const log = (await svc.from("activity_logs").select("detail").eq("target_id", big.id).eq("event_type", "delete")).data[0].detail;
  assert.equal(log.deleted_count, p.futureCount); assert.equal(log.retained_count, p.retainedCount);
});

// ---------------- M6: dayoff count with workplace_ids ----------------
await check("M6 dayoff count follows workplace_ids first, single column fallback, once per row; changes force 409", async () => {
  const t = await create("R2 Multi", "user");
  assert.ifError((await svc.from("daily_status").insert([
    row(t.id, 1, [k3, dayoff], k3),       // array contains dayoff -> counted
    row(t.id, 2, [], dayoff),             // empty array -> fall back to single column (dayoff) -> counted
    row(t.id, 3, [dayoff], dayoff),       // both -> counted once
    row(t.id, 4, [k3], k3),               // not dayoff
    { user_id: t.id, work_date: addDays(today, 5), workplace_id: k3, workplace_ids: null }, // null array -> single column (not dayoff)
    row(t.id, 6, [k3], dayoff),           // array wins over single column -> NOT dayoff
    row(t.id, -1, [dayoff], dayoff),      // past row, never counted as future
  ])).error);
  const p = await previewOf(t.id);
  assert.deepEqual([p.futureCount, p.futureDayoffCount, p.retainedCount], [6, 3, 1]);
  const sqlCounts = (await svc.rpc("delete_user_counts", { p_target_id: t.id, p_cutoff: p.cutoffDate })).data;
  assert.deepEqual([sqlCounts.futureCount, sqlCounts.futureDayoffCount, sqlCounts.retainedCount], [6, 3, 1]);
  // dayoff-only change (future/retained totals unchanged) must force re-confirmation
  assert.ifError((await svc.from("daily_status").update({ workplace_ids: [k3, dayoff] }).eq("user_id", t.id).eq("work_date", addDays(today, 4))).error);
  const stale = await call(deleteBodyFor(t, p)); assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.code, "PREVIEW_CHANGED"); assert.equal(stale.body.preview.futureDayoffCount, 4);
  assert.equal((await svc.from("profiles").select("id").eq("id", t.id).maybeSingle()).data?.id, t.id, "profile must be untouched by a 409");
  assert.equal(banned(await authState(t.id)), false, "a 409 must not leave the account disabled");
  // SQL itself also rejects a stale dayoff expectation
  const direct = await svc.rpc("delete_user_data", { p_actor_id: actor.id, p_target_id: t.id, p_confirm_name: t.name, p_expected_cutoff: p.cutoffDate, p_expected_future_count: 6, p_expected_dayoff_count: 3, p_expected_retained_count: 1, p_request_id: crypto.randomUUID() });
  assert.ok(direct.error && /preview_changed/.test(direct.error.message), `SQL must verify the dayoff count: ${JSON.stringify(direct.error)}`);
  const p2 = await previewOf(t.id); assert.equal(p2.futureDayoffCount, 4);
  const d = await call(deleteBodyFor(t, p2)); assert.equal(d.status, 200, JSON.stringify(d.body));
  const log = (await svc.from("activity_logs").select("detail").eq("target_id", t.id).eq("event_type", "delete")).data[0].detail;
  assert.equal(log.deleted_count, 6);
});

// ---------------- stale cutoff (midnight rollover) ----------------
await check("cutoff rolled over after preview -> 409, re-preview, confirm again, success", async () => {
  const t = await create("R2 Midnight", "user");
  assert.ifError((await svc.from("daily_status").insert([row(t.id, -1), row(t.id, 0), row(t.id, 1), row(t.id, 2)])).error);
  const p = await previewOf(t.id);
  // The preview was taken "yesterday": the database's Seoul date is one day later than the cutoff the user confirmed.
  const stale = await call(deleteBodyFor(t, p, { cutoffDate: addDays(p.cutoffDate, -1) })); assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.preview.cutoffDate, p.cutoffDate);
  const direct = await svc.rpc("delete_user_data", { p_actor_id: actor.id, p_target_id: t.id, p_confirm_name: t.name, p_expected_cutoff: addDays(p.cutoffDate, -1), p_expected_future_count: p.futureCount, p_expected_dayoff_count: p.futureDayoffCount, p_expected_retained_count: p.retainedCount, p_request_id: crypto.randomUUID() });
  assert.ok(direct.error && /preview_changed/.test(direct.error.message), `SQL must reject a stale cutoff: ${JSON.stringify(direct.error)}`);
  assert.equal((await svc.from("daily_status").select("id", { count: "exact", head: true }).eq("user_id", t.id)).count, 4, "nothing deleted by the rejected attempts");
  const fresh = await previewOf(t.id); const d = await call(deleteBodyFor(t, fresh)); assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal((await svc.from("daily_status").select("id", { count: "exact", head: true }).eq("user_id", t.id)).count, 2);
});

// ---------------- M3: RPC outcome classification against the real database ----------------
const isRpc = (input) => String(input).includes("/rest/v1/rpc/delete_user_data");
function recorder() {
  const log = [];
  const wrap = (decide) => async (input, init = {}) => {
    const method = (init.method || "GET").toUpperCase(); const target = String(input);
    if (target.includes("/auth/v1/admin/users/") && method === "PUT") { try { log.push(`ban:${JSON.parse(init.body).ban_duration}`); } catch { log.push("ban:?"); } }
    if (target.includes("/auth/v1/admin/users/") && method === "DELETE") log.push("auth-delete");
    const action = decide ? decide(target, method) : "forward";
    if (action === "drop-before") throw new TypeError("fetch failed");
    if (action === "503") return new Response(JSON.stringify({ message: "unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
    const response = await fetch(input, init);
    if (action === "drop-after") throw new TypeError("fetch failed");
    return response;
  };
  return { log, wrap };
}
await check("M3 explicit database error -> rolled back and account unbanned", async () => {
  const t = await create("R2 Explicit", "user"); assert.ifError((await svc.from("daily_status").insert([row(t.id, 1), row(t.id, -1)])).error);
  const p = await previewOf(t.id);
  execSql(`create or replace function public.r2_fail_profile_delete() returns trigger language plpgsql as $$ begin if old.id='${t.id}'::uuid then raise exception 'injected_delete_failure'; end if; return old; end $$; create trigger r2_fail_profile_delete before delete on public.profiles for each row execute function public.r2_fail_profile_delete();`);
  try {
    const rec = recorder(); const r = await call(deleteBodyFor(t, p), adminClient(rec.wrap()));
    assert.equal(r.body.code, "CLEANUP_FAILED", JSON.stringify(r.body)); assert.deepEqual(rec.log, ["ban:876000h", "ban:none"]);
    assert.equal(banned(await authState(t.id)), false);
    assert.equal((await svc.from("daily_status").select("id", { count: "exact", head: true }).eq("user_id", t.id)).count, 2);
    assert.equal((await svc.from("user_history_labels").select("deleted_at").eq("user_id", t.id).single()).data.deleted_at, null);
  } finally { execSql("drop trigger if exists r2_fail_profile_delete on public.profiles; drop function if exists public.r2_fail_profile_delete();"); }
});
await check("M3 response lost but transaction committed -> not unbanned, deletion completes", async () => {
  const t = await create("R2 LostCommitted", "user"); assert.ifError((await svc.from("daily_status").insert([row(t.id, 1), row(t.id, -1)])).error);
  const p = await previewOf(t.id); const rec = recorder();
  const r = await call(deleteBodyFor(t, p), adminClient(rec.wrap((u) => (isRpc(u) ? "drop-after" : "forward"))));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "deleted");
  assert.ok(!rec.log.includes("ban:none"), `must not unban: ${rec.log}`); assert.deepEqual(rec.log, ["ban:876000h", "auth-delete"]);
  assert.equal(await authState(t.id), null); assert.equal((await svc.from("profiles").select("id").eq("id", t.id).maybeSingle()).data, null);
  assert.ok((await svc.from("user_history_labels").select("deleted_at").eq("user_id", t.id).single()).data.deleted_at);
});
await check("M3 response lost and transaction NOT committed -> stays banned, retry completes", async () => {
  const t = await create("R2 LostNotCommitted", "user"); assert.ifError((await svc.from("daily_status").insert([row(t.id, 1), row(t.id, -1)])).error);
  const p = await previewOf(t.id); const rec = recorder();
  const r = await call(deleteBodyFor(t, p), adminClient(rec.wrap((u) => (isRpc(u) ? "drop-before" : "forward"))));
  assert.equal(r.status, 503, JSON.stringify(r.body)); assert.equal(r.body.code, "DELETE_STATE_UNKNOWN");
  assert.ok(!rec.log.includes("ban:none")); assert.equal(banned(await authState(t.id)), true, "account must stay disabled");
  assert.ok((await svc.from("profiles").select("id").eq("id", t.id).maybeSingle()).data, "profile still present");
  const s = await call({ action: "status", targetId: t.id }); assert.deepEqual(s.body, { profileExists: true, historyDeleted: false, authExists: true, authDisabled: true });
  const p2 = await previewOf(t.id); const retry = await call(deleteBodyFor(t, p2)); assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(await authState(t.id), null);
});
await check("M3 stuck state 2 (cleaned + disabled): status shows it and retry completes", async () => {
  const t = await create("R2 AuthPending", "user"); assert.ifError((await svc.from("daily_status").insert([row(t.id, 1), row(t.id, -1)])).error);
  const p = await previewOf(t.id); const rec = recorder();
  const r = await call(deleteBodyFor(t, p), adminClient(rec.wrap((u, m) => (m === "DELETE" && u.includes("/auth/v1/admin/users/") ? "503" : "forward"))));
  assert.equal(r.body.code, "AUTH_DELETE_PENDING", JSON.stringify(r.body));
  const s = await call({ action: "status", targetId: t.id }); assert.deepEqual(s.body, { profileExists: false, historyDeleted: true, authExists: true, authDisabled: true });
  const retry = await call({ action: "delete", targetId: t.id, retry: true }); assert.equal(retry.status, 200, JSON.stringify(retry.body)); assert.equal(await authState(t.id), null);
});

// ---------------- M2: Auth lookup classification against the real Auth service ----------------
await check("M2 real 404 -> absent; 503 / dropped connection -> AUTH_STATUS_UNKNOWN", async () => {
  const t = await create("R2 AuthLookup", "user");
  const missing = await call({ action: "status", targetId: crypto.randomUUID() }); assert.equal(missing.status, 200, JSON.stringify(missing.body)); assert.equal(missing.body.authExists, false);
  const authCall = (u, m) => (m === "GET" && /\/auth\/v1\/admin\/users\/[0-9a-f-]{36}/.test(u));
  for (const mode of ["503", "drop-before"]) {
    const r = await call({ action: "status", targetId: t.id }, adminClient(recorder().wrap((u, m) => (authCall(u, m) ? mode : "forward"))));
    assert.equal(r.status, 503, `${mode}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, "AUTH_STATUS_UNKNOWN");
  }
  const slow = adminClient(async (input, init = {}) => { if (authCall(String(input), (init.method || "GET").toUpperCase())) { const e = new Error("The operation timed out"); e.name = "TimeoutError"; throw e; } return fetch(input, init); });
  const timedOut = await call({ action: "status", targetId: t.id }, slow); assert.equal(timedOut.status, 503); assert.equal(timedOut.body.code, "AUTH_STATUS_UNKNOWN");
  const healthy = await call({ action: "status", targetId: t.id }); assert.equal(healthy.body.authExists, true);
});

// ---------------- m2: empty display_name falls back to email in JS and SQL ----------------
await check("m2 empty display_name uses email consistently (list, preview, SQL check, label, log)", async () => {
  const t = await create("R2 Blank", "user");
  assert.ifError((await svc.from("profiles").update({ display_name: "", email: t.email }).eq("id", t.id)).error);
  assert.equal((await svc.from("user_history_labels").select("display_name").eq("user_id", t.id).single()).data.display_name, t.email);
  const list = await call({ action: "list" }); assert.equal(list.body.users.find((u) => u.id === t.id).name, t.email);
  const p = await previewOf(t.id); assert.equal(p.confirmName, t.email);
  const wrong = await call(deleteBodyFor(t, p, { confirmName: "" })); assert.equal(wrong.body.code, "NAME_MISMATCH");
  const d = await call(deleteBodyFor(t, p)); assert.equal(d.status, 200, JSON.stringify(d.body));
  const log = (await svc.from("activity_logs").select("detail").eq("target_id", t.id).eq("event_type", "delete")).data[0].detail; assert.equal(log.target_name, t.email);
});

const failed = results.filter(([, status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} round-2 checks passed`);
process.exit(failed.length ? 1 : 0);
