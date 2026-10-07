// Local-only verification after the profiles lockdown patch (01_profiles_lockdown_production.sql):
//  1. role escalation / profile tampering attacks over REST must all be rejected
//  2. Create User regression (real function, on_auth_user_created path, label sync, failure compensation)
// Requires explicit loopback URL and process-only local keys. Never prints keys.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const url = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !anonKey || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error("Requires an explicit loopback Supabase URL and process-only local keys.");
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function execSql(sql) {
  const run = spawnSync("docker", ["exec", "-i", "supabase_db_team_schedule", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`local SQL failed: ${run.stderr}`);
}
const stamp = Date.now();
async function create(name, role) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "LocalTest123!", email_confirm: true, user_metadata: { display_name: name } });
  assert.ifError(error);
  assert.ifError((await admin.from("profiles").update({ role, display_name: name }).eq("id", data.user.id)).error);
  const login = await createClient(url, anonKey).auth.signInWithPassword({ email, password: "LocalTest123!" });
  assert.ifError(login.error);
  return { id: data.user.id, email, name, token: login.data.session.access_token };
}
const rest = (token, method, path, body, extra = {}) =>
  fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.text() }));

const adminUser = await create("Lockdown Admin", "admin");
const victim = await create("Lockdown Victim", "user");
const attackers = [await create("Lockdown User", "user"), await create("Lockdown Viewer", "viewer")];
const report = [];
async function attack(who, label, token, method, path, body, extra) {
  const r = await rest(token, method, path, body, extra);
  const blocked = r.status >= 400 || r.body === "[]" || r.body === "";
  report.push({ who, attack: label, status: r.status, response: r.body.slice(0, 160), blocked });
  return r;
}
for (const a of attackers) {
  const who = a.name;
  await attack(who, "UPDATE own role -> admin", a.token, "PATCH", `profiles?id=eq.${a.id}`, { role: "admin" });
  await attack(who, "UPDATE own display_name", a.token, "PATCH", `profiles?id=eq.${a.id}`, { display_name: "tamper" });
  await attack(who, "UPDATE other's role -> viewer", a.token, "PATCH", `profiles?id=eq.${victim.id}`, { role: "viewer" });
  await attack(who, "UPDATE other's display_name", a.token, "PATCH", `profiles?id=eq.${victim.id}`, { display_name: "tamper" });
  await attack(who, "INSERT profile with role admin", a.token, "POST", "profiles", { id: crypto.randomUUID(), display_name: "ghost", role: "admin" });
  await attack(who, "UPSERT own profile role admin", a.token, "POST", "profiles?on_conflict=id", { id: a.id, role: "admin" }, { Prefer: "return=representation,resolution=merge-duplicates" });
  await attack(who, "DELETE own profile", a.token, "DELETE", `profiles?id=eq.${a.id}`);
  await attack(who, "same-value role write (permission denied expected)", a.token, "PATCH", `profiles?id=eq.${a.id}`, { role: a.name.includes("Viewer") ? "viewer" : "user" });
}
// DB state unchanged
for (const a of attackers) {
  const row = (await admin.from("profiles").select("role,display_name").eq("id", a.id).single()).data;
  assert.equal(row.role, a.name.includes("Viewer") ? "viewer" : "user");
  assert.equal(row.display_name, a.name);
}
assert.equal((await admin.from("profiles").select("role,display_name").eq("id", victim.id).single()).data.role, "user");
assert.ok(report.every((r) => r.blocked), "every attack must be blocked");

// sign-up path with role in metadata: profile must be role=user (local signup is enabled; production has it disabled)
const signupEmail = `signup-${stamp}@local.test`;
const signup = await createClient(url, anonKey).auth.signUp({ email: signupEmail, password: "LocalTest123!", options: { data: { role: "admin", display_name: "Signup Probe" } } });
assert.ifError(signup.error);
const signupProfile = (await admin.from("profiles").select("role,display_name").eq("id", signup.data.user.id).single()).data;
assert.equal(signupProfile.role, "user");

// Create User regression through the real Edge Function
const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${adminUser.token}` } }, auth: { persistSession: false } });
const createdEmail = `created-${stamp}@local.test`;
const ok = await caller.functions.invoke("create-user", { body: { email: createdEmail, password: "LocalTest123!", role: "viewer" } });
assert.ifError(ok.error);
const createdId = ok.data.id;
const createdProfile = (await admin.from("profiles").select("role,email,display_name").eq("id", createdId).single()).data;
assert.equal(createdProfile.role, "viewer");
assert.equal(createdProfile.email, createdEmail);
const createdLabel = (await admin.from("user_history_labels").select("display_name,deleted_at").eq("user_id", createdId).single()).data;
assert.equal(createdLabel.display_name, createdProfile.display_name);
assert.equal(createdLabel.deleted_at, null);
// labels follow display_name changes (service role update)
assert.ifError((await admin.from("profiles").update({ display_name: "Renamed Creator" }).eq("id", createdId)).error);
assert.equal((await admin.from("user_history_labels").select("display_name").eq("user_id", createdId).single()).data.display_name, "Renamed Creator");

// compensation path: make the profile upsert fail for one email; function must roll the Auth user back
const failEmail = `compfail-${stamp}@local.test`;
execSql(`create or replace function public.test_fail_profile_write() returns trigger language plpgsql as $$ begin if new.email = '${failEmail}' then raise exception 'injected_profile_failure'; end if; return new; end $$; create trigger test_fail_profile_write before insert or update on public.profiles for each row execute function public.test_fail_profile_write();`);
let compensation;
try {
  const failed = await caller.functions.invoke("create-user", { body: { email: failEmail, password: "LocalTest123!", role: "user" } });
  assert.ok(failed.error);
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  compensation = { authUserRolledBack: !list.data.users.some((u) => u.email === failEmail), profileRemaining: (await admin.from("profiles").select("id").eq("email", failEmail)).data.length };
  assert.equal(compensation.authUserRolledBack, true);
  assert.equal(compensation.profileRemaining, 0);
} finally {
  execSql("drop trigger if exists test_fail_profile_write on public.profiles; drop function if exists public.test_fail_profile_write();");
}
// same email can be created again after rollback
const retry = await caller.functions.invoke("create-user", { body: { email: failEmail, password: "LocalTest123!", role: "user" } });
assert.ifError(retry.error);

console.log(JSON.stringify({ loopback: true, attacks: report, signupMetadataRoleIgnored: signupProfile.role, createUser: { role: createdProfile.role, emailWritten: true, labelSynced: true, labelFollowsRename: true }, compensation, recreateAfterRollback: true }, null, 2));
