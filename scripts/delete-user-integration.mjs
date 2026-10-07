import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const url = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !anonKey || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error("Integration tests require an explicit loopback Supabase URL and process-only local keys.");
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function execSql(sql) {
  const run = spawnSync("docker", ["exec", "-i", "supabase_db_team_schedule", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding:"utf8" });
  if (run.status !== 0) throw new Error(`local SQL test failed: ${run.stderr}`);
}
const emailSuffix = `${Date.now()}@local.test`;
async function create(name, role) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${emailSuffix}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "LocalTest123!", email_confirm: true, user_metadata: { display_name: name } });
  assert.ifError(error); assert.ok(data.user);
  const update = await admin.from("profiles").update({ role, display_name: name }).eq("id", data.user.id).select().single();
  assert.ifError(update.error);
  return { id: data.user.id, email, password: "LocalTest123!", name };
}

const actor = await create("Local Admin", "admin");
const user = await create("Delete User", "user");
const viewer = await create("Delete Viewer", "viewer");
const other = await create("Other User", "user");
const workplace = (await admin.from("workplaces").select("id").eq("name", "K3").single()).data;
const dayoff = (await admin.from("workplaces").select("id").eq("is_dayoff", true).limit(1).single()).data;
assert.ok(workplace && dayoff);

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, days) => { const date = new Date(`${iso}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0,10); };
for (const target of [user, viewer]) {
  const rows = [-1,0,1,2].map((offset) => ({ user_id: target.id, work_date: addDays(today,offset), workplace_id: offset === 2 ? dayoff.id : workplace.id, workplace_ids: [offset === 2 ? dayoff.id : workplace.id] }));
  assert.ifError((await admin.from("daily_status").insert(rows)).error);
}
assert.ifError((await admin.from("activity_logs").insert([{ user_id: user.id, event_type:"login", detail:{fixture:true} },{ user_id:null,event_type:"login",detail:{fixture:true} }])).error);

const beforeLogs = await admin.from("activity_logs").select("*").order("id"); assert.ifError(beforeLogs.error);
const { data: session, error: loginError } = await createClient(url, anonKey).auth.signInWithPassword({ email: actor.email, password: actor.password }); assert.ifError(loginError);
const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${session.session.access_token}` } }, auth: { persistSession:false } });
async function invoke(body) { const res = await caller.functions.invoke("delete-user", { body }); if (res.error) throw new Error(JSON.stringify(res.data || res.error)); return res.data; }

const functionUrl = `${url}/functions/v1/delete-user`;
const noJwt = await fetch(functionUrl, { method:"POST", headers:{apikey:anonKey,"Content-Type":"application/json"}, body:JSON.stringify({action:"list"}) });
assert.equal(noJwt.status,401);
const fakeJwt = await fetch(functionUrl, { method:"POST", headers:{apikey:anonKey,Authorization:"Bearer forged.jwt.value","Content-Type":"application/json"}, body:JSON.stringify({action:"list"}) });
assert.equal(fakeJwt.status,401);
const userSession = await createClient(url,anonKey).auth.signInWithPassword({email:user.email,password:user.password}); assert.ifError(userSession.error);
for (const action of ["list","preview","delete","status"]) {
  const response = await fetch(functionUrl,{method:"POST",headers:{apikey:anonKey,Authorization:`Bearer ${userSession.data.session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({action,targetId:viewer.id})});
  assert.equal(response.status,403,`${action} must reject a non-admin`);
}

const list = await invoke({action:"list"}); assert.deepEqual(new Set(list.users.map((x)=>x.role)), new Set(["user","viewer"])); assert.ok(!list.users.some((x)=>x.id===actor.id));

const rollbackTarget = await create("Rollback User", "user");
assert.ifError((await admin.from("daily_status").insert({user_id:rollbackTarget.id,work_date:addDays(today,1),workplace_id:workplace.id,workplace_ids:[workplace.id]})).error);
const rollbackPreview = await invoke({action:"preview",targetId:rollbackTarget.id});
execSql(`create or replace function public.test_fail_profile_delete() returns trigger language plpgsql as $$ begin if old.id='${rollbackTarget.id}'::uuid then raise exception 'injected_delete_failure'; end if; return old; end $$; create trigger test_fail_profile_delete before delete on public.profiles for each row execute function public.test_fail_profile_delete();`);
let rollbackFailed=false;
try { await invoke({action:"delete",targetId:rollbackTarget.id,confirmName:rollbackTarget.name,cutoffDate:rollbackPreview.cutoffDate,futureCount:rollbackPreview.futureCount,futureDayoffCount:rollbackPreview.futureDayoffCount,retainedCount:rollbackPreview.retainedCount}); } catch { rollbackFailed=true; }
assert.equal(rollbackFailed,true);
assert.ok((await admin.from("profiles").select("id").eq("id",rollbackTarget.id).single()).data);
assert.equal((await admin.from("daily_status").select("id").eq("user_id",rollbackTarget.id)).data.length,1);
assert.equal((await admin.from("user_history_labels").select("deleted_at").eq("user_id",rollbackTarget.id).single()).data.deleted_at,null);
assert.ifError((await createClient(url,anonKey).auth.signInWithPassword({email:rollbackTarget.email,password:rollbackTarget.password})).error);
execSql("drop trigger test_fail_profile_delete on public.profiles; drop function public.test_fail_profile_delete();");

const concurrentTarget = await create("Concurrent User", "user");
assert.ifError((await admin.from("daily_status").insert({user_id:concurrentTarget.id,work_date:addDays(today,1),workplace_id:workplace.id,workplace_ids:[workplace.id]})).error);
const concurrentPreview=await invoke({action:"preview",targetId:concurrentTarget.id});
execSql(`create or replace function public.test_slow_profile_delete() returns trigger language plpgsql as $$ begin if old.id='${concurrentTarget.id}'::uuid then perform pg_sleep(2); end if; return old; end $$; create trigger test_slow_profile_delete before delete on public.profiles for each row execute function public.test_slow_profile_delete();`);
const deletingPromise=invoke({action:"delete",targetId:concurrentTarget.id,confirmName:concurrentTarget.name,cutoffDate:concurrentPreview.cutoffDate,futureCount:concurrentPreview.futureCount,futureDayoffCount:concurrentPreview.futureDayoffCount,retainedCount:concurrentPreview.retainedCount});
await new Promise((resolve)=>setTimeout(resolve,500));
const concurrentInsert=await admin.from("daily_status").insert({user_id:concurrentTarget.id,work_date:addDays(today,3),workplace_id:workplace.id,workplace_ids:[workplace.id]});
await deletingPromise;
assert.ok(concurrentInsert.error);
assert.equal((await admin.from("daily_status").select("id").eq("user_id",concurrentTarget.id).gt("work_date",today)).data.length,0);
execSql("drop trigger test_slow_profile_delete on public.profiles; drop function public.test_slow_profile_delete();");
for (const target of [user, viewer]) {
  const preview = await invoke({action:"preview",targetId:target.id});
  assert.equal(preview.futureCount,2); assert.equal(preview.futureDayoffCount,1); assert.equal(preview.retainedCount,2);
  const deleted = await invoke({action:"delete",targetId:target.id,confirmName:target.name,cutoffDate:preview.cutoffDate,futureCount:preview.futureCount,futureDayoffCount:preview.futureDayoffCount,retainedCount:preview.retainedCount}); assert.equal(deleted.status,"deleted");
  const remaining = await admin.from("daily_status").select("work_date").eq("user_id",target.id); assert.equal(remaining.data.length,2); assert.ok(remaining.data.every((row)=>row.work_date<=today));
  assert.equal((await admin.from("profiles").select("id").eq("id",target.id).maybeSingle()).data,null);
  assert.ok((await admin.from("user_history_labels").select("deleted_at").eq("user_id",target.id).single()).data.deleted_at);
  assert.ok((await admin.auth.admin.getUserById(target.id)).error);
  assert.ok((await admin.from("daily_status").insert({user_id:target.id,work_date:addDays(today,-2),workplace_id:workplace.id,workplace_ids:[workplace.id]})).error);
  assert.ok((await admin.from("activity_logs").insert({user_id:target.id,event_type:"login"})).error);
}

const afterLogs = await admin.from("activity_logs").select("*").order("id"); assert.ifError(afterLogs.error);
for (const oldRow of beforeLogs.data) assert.deepEqual(afterLogs.data.find((row)=>row.id===oldRow.id), oldRow);
assert.equal(afterLogs.data.filter((row)=>row.detail?.action==="delete_user").length,3);

const recreated = await create("Delete User", "user"); assert.notEqual(recreated.id,user.id);
assert.equal((await admin.from("daily_status").select("id").eq("user_id",recreated.id)).data.length,0);

const temp = await create("Ban Roundtrip", "user");
assert.ifError((await admin.auth.admin.updateUserById(temp.id,{ban_duration:"876000h"})).error);
assert.ok((await admin.auth.admin.getUserById(temp.id)).data.user.banned_until);
assert.ifError((await admin.auth.admin.updateUserById(temp.id,{ban_duration:"none"})).error);
assert.ifError((await admin.auth.admin.deleteUser(temp.id)).error);

async function roleProbe(account) {
  const { data } = await createClient(url,anonKey).auth.signInWithPassword({email:account.email,password:account.password});
  const client=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${data.session.access_token}`}},auth:{persistSession:false}});
  const own=await client.from("profiles").update({role:"admin"}).eq("id",account.id).select();
  const others=await client.from("profiles").update({display_name:"tamper"}).eq("id",other.id).select();
  return { ownRoleChanged: !own.error && own.data?.some((row)=>row.role==="admin"), otherProfileChanged: !others.error && others.data?.length>0, ownError: Boolean(own.error), otherError:Boolean(others.error) };
}
const probeViewer = await create("Probe Viewer", "viewer");
const userProbe=await roleProbe(recreated); const viewerProbe=await roleProbe(probeViewer);
assert.equal(userProbe.otherProfileChanged,false);
assert.equal(viewerProbe.otherProfileChanged,false);

console.log(JSON.stringify({ loopback:true, noJwt401:true, forgedJwt401:true, nonAdminAllActions403:true, deleteUserAndViewer:true, retainedBoundary:true, existingLogsUnchanged:true, transactionRollback:true, unbanAfterRollback:true, concurrentInsertBlocked:true, deletedUserWritesBlocked:true, sameNameNewUuid:true, banUnbanRoundtrip:true, userProbe, viewerProbe },null,2));
