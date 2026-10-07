// Round-3 UI verification (local app + local Supabase only), driven through Chrome DevTools Protocol.
// Covers: R3-M1 (unknown outcomes ask status first: committed-but-unknown, unknown-then-committed, status failing, 404 on retry),
// R3-m1 (consecutive deletions on one page: previous success toast cleared), R3-M2 display layer (Logs page ignores a forged
// detail.actor_name and still renders the real delete-user event). Network faults are injected with CDP Fetch interception;
// server state is real (local stack).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { handleDeleteUser } from "../supabase/functions/delete-user/handler.ts";

const debugUrl = process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9222";
const appUrl = process.env.LOCAL_APP_URL;
const evidenceDir = process.env.UI_EVIDENCE_DIR;
const supaUrl = process.env.LOCAL_SUPABASE_URL, anonKey = process.env.LOCAL_SUPABASE_ANON_KEY, serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
if (!appUrl || !evidenceDir || !supaUrl || !anonKey || !serviceKey || !loopback.test(appUrl) || !loopback.test(supaUrl)) throw new Error("Requires loopback app + Supabase URLs and process-only local keys.");
fs.mkdirSync(evidenceDir, { recursive: true });

const svc = createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ADMIN_EMAIL = "ui-admin@local.test", PASSWORD = "LocalUi123!";
const stamp = Date.now();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (days) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const k3 = (await svc.from("workplaces").select("id").eq("name", "K3").single()).data.id;
async function fixture(baseName, { rows = [-1, 0, 1], ot = false, email, blankName = false } = {}) {
  const name = `${baseName} ${String(stamp).slice(-5)}`; // unique per run so earlier fixtures never match
  const mail = email || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@local.test`;
  const { data, error } = await svc.auth.admin.createUser({ email: mail, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name } });
  assert.ifError(error);
  assert.ifError((await svc.from("profiles").update({ role: "user", display_name: blankName ? "" : name, email: mail }).eq("id", data.user.id)).error);
  assert.ifError((await svc.from("daily_status").insert(rows.map((offset) => ({ user_id: data.user.id, work_date: addDays(offset), workplace_id: k3, workplace_ids: [k3], overtime_enabled: ot && offset === 0, overtime_hours: ot && offset === 0 ? 2 : 0 })))).error);
  return { id: data.user.id, name, email: mail };
}

// ---- CDP plumbing ----
const page = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let nextId = 0; const pending = new Map(); const eventHandlers = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { const { ok, fail } = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result); }
  else if (msg.method) for (const handler of eventHandlers) handler(msg);
};
const send = (method, params = {}) => new Promise((ok, fail) => { const id = ++nextId; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expression.slice(0, 80)); return r.result.value; }
async function waitFor(expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { if (await evaluate(expression)) return; } catch { /* page is navigating */ } await sleep(150); }
  throw new Error(`timeout: ${expression}\n${JSON.stringify(await evaluate(`({href:location.href,text:document.body.innerText.slice(0,900)})`))}`);
}
async function shot(name) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(evidenceDir, `${name}.png`), Buffer.from(r.data, "base64")); }
const q = JSON.stringify;
const setInput = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${q(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${q(value)});e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${q(value)}}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const clickText = (text) => evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${q(text)});if(!e)return false;e.click();return true})()`);
const bodyText = () => evaluate("document.body.innerText");
const buttonState = (label) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${q(label)});return b?{exists:true,disabled:b.disabled}:{exists:false}})()`);

// Fault injection rules: evaluated in order for each paused request. action: continue | fail | fulfill | dropResponse
const rules = []; const seen = [];
let lateCommitTrace = null;
const traceLateCommit = (event, details = {}) => {
  if (lateCommitTrace) lateCommitTrace.push({ sequence: lateCommitTrace.length + 1, time: new Date().toISOString(), event, ...details });
};
eventHandlers.push(async (msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const p = msg.params; const req = p.request; const isResponseStage = p.responseStatusCode !== undefined || p.responseErrorReason !== undefined;
  try {
    if (req.method === "OPTIONS") { await send("Fetch.continueRequest", { requestId: p.requestId }); return; }
    if (isResponseStage) {
      if (lateCommitTrace && fnAction(req, "status")) {
        const response = await send("Fetch.getResponseBody", { requestId: p.requestId });
        const body = JSON.parse(response.base64Encoded ? Buffer.from(response.body, "base64").toString("utf8") : response.body);
        traceLateCommit("browser-status-response", { httpStatus: p.responseStatusCode, body });
      }
      if (dropAfter.has(p.requestId)) { dropAfter.delete(p.requestId); await send("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" }); }
      else await send("Fetch.continueResponse", { requestId: p.requestId });
      return;
    }
    if (lateCommitTrace && isFn(req)) traceLateCommit("browser-request", { action: JSON.parse(req.postData || "{}").action });
    const rule = rules.find((r) => r.match(req));
    if (!rule) { await send("Fetch.continueRequest", { requestId: p.requestId }); return; }
    rule.hits = (rule.hits || 0) + 1; seen.push(`${rule.name}:${req.method}:${req.url.split("?")[0].split("/").slice(-2).join("/")}`);
    if (rule.once) rules.splice(rules.indexOf(rule), 1);
    if (rule.before) await rule.before(req);
    if (rule.action === "fail") await send("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" });
    else if (rule.action === "fulfill") await send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: rule.status, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(JSON.stringify(rule.body)).toString("base64") });
    else if (rule.action === "dropResponse") { dropAfter.add(p.requestId); await send("Fetch.continueRequest", { requestId: p.requestId }); }
    else await send("Fetch.continueRequest", { requestId: p.requestId });
  } catch (error) { console.error("fetch-intercept error", String(error.message).slice(0, 120)); }
});
const dropAfter = new Set();
const isFn = (req) => req.url.includes("/functions/v1/delete-user");
const fnAction = (req, action) => { if (!isFn(req) || !req.postData) return false; try { return JSON.parse(req.postData).action === action; } catch { return false; } };
const fnBody = (req, pred) => { try { return pred(JSON.parse(req.postData)); } catch { return false; } };

async function login(email) {
  await send("Page.navigate", { url: `${appUrl}/login` });
  await waitFor(`document.querySelector('input[type=email]')!==null`); await sleep(6000);
  await setInput("input[type=email]", email); await setInput("input[type=password]", PASSWORD); await sleep(250);
  assert.equal(await clickText("Login"), true);
  await waitFor(`location.pathname==='/' && document.body.innerText.includes('Workplace & Day Off Calendar')`);
}
async function openModal() {
  await waitFor(`document.querySelector('[aria-label="Delete User"]')!==null`);
  await evaluate(`document.querySelector('[aria-label="Delete User"]').click()`); await waitFor(`document.body.innerText.includes('刪除使用者')`);
}
async function selectTarget(name) {
  await waitFor(`[...document.querySelectorAll('select option')].some(x=>x.textContent.includes(${q(name)}))`);
  await evaluate(`(()=>{const s=document.querySelector('select');const o=[...s.options].find(x=>x.textContent.includes(${q(name)}));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.body.innerText.includes('輸入「${name}」確認')`);
}
async function reloadHome() { await send("Page.navigate", { url: appUrl }); await waitFor(`document.body.innerText.includes('Workplace & Day Off Calendar')`); await sleep(1500); }
const results = {};
async function scenario(name, fn) { try { await fn(); results[name] = "PASS"; console.log(`PASS ${name}`); } catch (error) { results[name] = "FAIL"; console.log(`FAIL ${name}: ${String(error.message).slice(0, 600)}`); } finally { rules.length = 0; dropAfter.clear(); } }

const remoteSupabaseHits = [];
eventHandlers.push((msg) => { if (msg.method === "Network.requestWillBeSent" && /supabase.(co|in)/i.test(msg.params.request.url)) remoteSupabaseHits.push(msg.params.request.url.split("/")[2]); });
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.navigate", { url: appUrl }); await waitFor(`document.readyState==='complete'`); await evaluate(`localStorage.clear()`); await send("Network.clearBrowserCookies");
await login(ADMIN_EMAIL);
await send("Fetch.enable", { patterns: [
  { urlPattern: "*/functions/v1/delete-user*", requestStage: "Request" }, { urlPattern: "*/functions/v1/delete-user*", requestStage: "Response" },
  { urlPattern: "*/rest/v1/*", requestStage: "Request" },
] });


const adminSession = (await createClient(supaUrl, anonKey).auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD })).data.session;
const adminProfile = (await svc.from("profiles").select("id,display_name").eq("id", adminSession.user.id).single()).data;
assert.ok(adminProfile && adminProfile.display_name, "admin fixture profile");
const caller = createClient(supaUrl, anonKey, { global: { headers: { Authorization: `Bearer ${adminSession.access_token}` } }, auth: { persistSession: false } });
const failingAuthDelete = createClient(supaUrl, serviceKey, { auth: { persistSession: false }, global: { fetch: async (input, init = {}) => (String(input).includes("/auth/v1/admin/users/") && (init.method || "GET").toUpperCase() === "DELETE" ? new Response("{}", { status: 503 }) : fetch(input, init)) } });
const previewOf = async (t) => (await handleDeleteUser(caller, svc, { action: "preview", targetId: t.id })).body;
const deleteBody = (t, p) => ({ action: "delete", targetId: t.id, confirmName: t.name, cutoffDate: p.cutoffDate, futureCount: p.futureCount, futureDayoffCount: p.futureDayoffCount, retainedCount: p.retainedCount });
async function makeStuckCleaned(t) { // data cleaned, Auth account disabled but still present
  const p = await previewOf(t); const r = await handleDeleteUser(caller, failingAuthDelete, deleteBody(t, p)); assert.equal(r.body.code, "AUTH_DELETE_PENDING");
}
const hasButton = (label) => evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${q(label)})`);
const statusHits = () => seen.filter((e) => e.startsWith("status-seen")).length;
const unknownReply = { name: "unknown-reply", action: "fulfill", status: 503, body: { code: "DELETE_STATE_UNKNOWN", error: "stub" }, once: true, match: (req) => fnAction(req, "delete") && !fnBody(req, (b) => b.retry === true) };
const statusSeen = { name: "status-seen", action: "continue", match: (req) => fnAction(req, "status") };
const AUTH_GONE = async (t) => assert.ok((await svc.auth.admin.getUserById(t.id)).error, "auth account really gone");

// R3-M1 (a): transaction committed, the cleanup-state query failed -> backend says DELETE_STATE_UNKNOWN.
// The UI must ask status first, find "cleaned, Auth still there" and retry with retry:true (a plain retry would get 404).
const tA = await fixture("UI R3 Committed");
await scenario("R3-M1 (a) DELETE_STATE_UNKNOWN but data already cleaned -> status first -> retry:true completes", async () => {
  await reloadHome(); await openModal(); await selectTarget(tA.name); await setInput("input", tA.name);
  await makeStuckCleaned(tA);
  rules.push({ ...unknownReply }, { ...statusSeen }); seen.length = 0;
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='重試完成刪除')`, 15000);
  assert.ok(statusHits() >= 1, "status must be queried before choosing a retry mode");
  await shot("r3-01-committed-unknown-status-first");
  assert.ok(!(await bodyText()).includes("使用者已刪除成功。"));
  assert.equal(await clickText("重試完成刪除"), true);
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 15000); await AUTH_GONE(tA);
});

// R3-M1 (b): backend reports "unknown", but the delete commits afterwards -> status shows the latest state, UI completes.
const tB = await fixture("UI R3 LateCommit");
await scenario("R3-M1 (b) reported unknown, commit completes afterwards -> status shows latest state -> success", async () => {
  await reloadHome(); await openModal(); await selectTarget(tB.name); await setInput("input", tB.name);
  const p = await previewOf(tB);
  // Real handler disables Auth before attempting cleanup. Reproduce that precondition only;
  // no cleanup or hard deletion is performed until the browser has seen the uncleaned status.
  assert.ifError((await svc.auth.admin.updateUserById(tB.id, { ban_duration: "876000h" })).error);
  lateCommitTrace = [];
  try {
    traceLateCommit("fixture-disabled-without-cleanup", { targetId: tB.id });
    rules.push({ ...unknownReply }, { ...statusSeen }); seen.length = 0;
    assert.equal(await clickText("刪除使用者"), true);
    await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='重試刪除' && !b.disabled)`, 15000);
    const firstStatus = lateCommitTrace.find((e) => e.event === "browser-status-response");
    assert.equal(firstStatus?.httpStatus, 200);
    assert.equal(firstStatus.body.profileExists, true);
    assert.equal(firstStatus.body.historyDeleted, false);
    assert.equal(firstStatus.body.authExists, true);
    assert.equal(firstStatus.body.authDisabled, true);
    traceLateCommit("unknown-received-uncleaned-retry-visible", { message: await evaluate("document.querySelector('[role=alert]')?.textContent") });
    await shot("r4-02a-unknown-before-commit");
    const r = await handleDeleteUser(caller, svc, deleteBody(tB, p));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    traceLateCommit("real-handler-delete-completed", { httpStatus: r.status });
    const profile = await svc.from("profiles").select("id").eq("id", tB.id).maybeSingle();
    assert.ifError(profile.error); assert.equal(profile.data, null);
    const auth = await svc.auth.admin.getUserById(tB.id);
    assert.equal(auth.error?.status, 404);
    traceLateCommit("server-state", { profileExists: false, authStatus: auth.error.status });
    traceLateCommit("user-clicks-retry");
    assert.equal(await clickText("重試刪除"), true);
    await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 15000);
    const statuses = lateCommitTrace.filter((e) => e.event === "browser-status-response");
    assert.ok(statuses.length >= 2);
    const last = statuses.at(-1);
    assert.equal(last.body.profileExists, false); assert.equal(last.body.historyDeleted, true); assert.equal(last.body.authExists, false);
    assert.ok(firstStatus.sequence < lateCommitTrace.find((e) => e.event === "real-handler-delete-completed").sequence);
    traceLateCommit("final-screen", { message: "使用者已刪除成功。", samePage: true });
    await shot("r3-02-late-commit-success");
  } finally {
    fs.writeFileSync(path.join(evidenceDir, "r4-late-commit-sequence.json"), JSON.stringify(lateCommitTrace, null, 2));
    lateCommitTrace = null;
  }
});

// R3-M1 (c): status itself fails -> "cannot confirm" + re-query button, no default branch; re-query then resolves.
const tC = await fixture("UI R3 StatusDown");
await scenario("R3-M1 (c) status failing -> 無法確認 + 重新查詢, no default branch; re-query resolves", async () => {
  await reloadHome(); await openModal(); await selectTarget(tC.name); await setInput("input", tC.name);
  rules.push({ ...unknownReply }, { name: "status-down", action: "fail", match: (req) => fnAction(req, "status") }); seen.length = 0;
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('暫時無法確認帳號狀態')`, 15000); await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='重新查詢')`, 5000);
  for (const label of ["重試完成刪除", "重試刪除"]) assert.equal(await hasButton(label), false, `no default retry branch (${label})`);
  assert.ok(!(await bodyText()).includes("使用者已刪除成功。")); await shot("r3-03-status-down-requery");
  rules.length = 0; rules.push({ ...statusSeen });                       // status works again
  assert.equal(await clickText("重新查詢"), true);
  await waitFor(`document.body.innerText.includes('刪除未完成，帳號與資料都沒有變更')`, 15000);   // nothing was really deleted (the unknown reply was a stub)
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 15000); await AUTH_GONE(tC);
});

// R3-M1 (d): a retry that answers 404 is not a definitive failure -> status is queried again.
const tD = await fixture("UI R3 Retry404");
await scenario("R3-M1 (d) 404 on retry -> status queried again, retry state kept, real retry completes", async () => {
  await reloadHome(); await openModal(); await selectTarget(tD.name); await setInput("input", tD.name);
  await makeStuckCleaned(tD);
  rules.push({ name: "pending-reply", action: "fulfill", status: 502, body: { code: "AUTH_DELETE_PENDING", error: "stub" }, once: true, match: (req) => fnAction(req, "delete") && !fnBody(req, (b) => b.retry === true) },
    { name: "retry-404", action: "fulfill", status: 404, body: { error: "找不到目標帳號。" }, once: true, match: (req) => fnAction(req, "delete") && fnBody(req, (b) => b.retry === true) }, { ...statusSeen }); seen.length = 0;
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='重試完成刪除')`, 15000);
  const before = statusHits(); assert.ok(before >= 1, "AUTH_DELETE_PENDING goes through status first");
  assert.equal(await clickText("重試完成刪除"), true);                    // this retry is answered with 404
  await sleep(2500);
  assert.ok(statusHits() > before, "the 404 must trigger another status query");
  assert.ok(!(await bodyText()).includes("找不到目標帳號"), "404 must not be shown as a dead-end failure");
  await waitFor(`document.body.innerText.includes('刪除未完成：帳號已停用、資料已清理')`, 5000);
  assert.equal(await hasButton("重試完成刪除"), true); await shot("r3-04-retry-404-requery");
  assert.equal(await clickText("重試完成刪除"), true);
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 15000); await AUTH_GONE(tD);
});

// R3-m1: two deletions on the same page without reloading. A succeeds (toast), B's refresh fails: only B's message may show.
const tE = await fixture("UI R3 Seq A"), tF = await fixture("UI R3 Seq B", { ot: true });
await scenario("R3-m1 consecutive deletions on one page: previous success toast is cleared", async () => {
  await reloadHome(); await openModal(); await selectTarget(tE.name); await setInput("input", tE.name);
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 15000); await shot("r3-05-first-delete-toast");
  await openModal();                                                       // same page, no reload
  assert.ok(!(await bodyText()).includes("使用者已刪除成功。"), "toast cleared as soon as a new delete operation begins");
  await selectTarget(tF.name); await setInput("input", tF.name);
  rules.push({ name: "block-calendar-rows", action: "fail", match: (req) => req.method === "GET" && /\/rest\/v1\/daily_status\?/.test(req.url) && !req.url.includes("overtime_enabled") });
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('已刪除成功，畫面更新失敗')`, 15000);
  assert.ok(!(await bodyText()).includes("使用者已刪除成功。"), "A's success message must not remain next to B's failure");
  await shot("r3-06-second-delete-refresh-failed");
  assert.equal((await svc.from("profiles").select("id").eq("id", tF.id).maybeSingle()).data, null);
});

// R3-M2 display: forged detail.actor_name on an ordinary event is ignored; the real delete-user event shows both names.
await scenario("R3-M2 Logs page: forged actor_name ignored, real delete-user event shows actor and target", async () => {
  const mallory = await fixture("Mallory UI", { rows: [0] });
  const mSession = (await createClient(supaUrl, anonKey).auth.signInWithPassword({ email: mallory.email, password: PASSWORD })).data.session;
  const mrest = createClient(supaUrl, anonKey, { global: { headers: { Authorization: `Bearer ${mSession.access_token}` } }, auth: { persistSession: false } });
  const forged = await mrest.from("activity_logs").insert({ user_id: mallory.id, event_type: "login", detail: { actor_name: "Impersonated Boss" } });
  assert.ifError(forged.error);                                            // an ordinary event is allowed; its detail is not trusted
  const reservedForgery = await mrest.from("activity_logs").insert({ user_id: mallory.id, event_type: "delete", target_table: "profiles", target_id: mallory.id, detail: { action: "delete_user", actor_name: "Impersonated Boss", target_name: "Forged Victim" } });
  const reservedBlocked = Boolean(reservedForgery.error);
  await send("Page.navigate", { url: `${appUrl}/admin/logs` }); await waitFor(`document.querySelectorAll('tr').length > 2`, 30000); await sleep(2500);
  const text = await bodyText();
  assert.ok(text.includes(`${mallory.name} logged in`), "the forged row is shown with its real owner");
  assert.ok(!text.includes("Impersonated Boss"), "forged actor name never shown");
  assert.ok(!text.includes("Forged Victim"), "forged delete-user event never shown");
  assert.equal(reservedBlocked, true, "database rejects the reserved-type forgery");
  const rows = await evaluate(`[...document.querySelectorAll('tr')].map(r=>r.innerText.replace(/\\s+/g,' '))`);
  const real = rows.find((r) => r.includes(`刪除使用者 ${tE.name}`));
  assert.ok(real, `real delete-user event for ${tE.name} must be listed`); assert.ok(real.includes(adminProfile.display_name), `real event shows the executing admin: ${real}`);
  await shot("r3-07-logs-forged-ignored-real-shown");
});

assert.equal(remoteSupabaseHits.length, 0, "the app must only talk to the local stack");
const failed = Object.entries(results).filter(([, v]) => v === "FAIL");
console.log(JSON.stringify({ results, onlyLocalSupabase: remoteSupabaseHits.length === 0 }, null, 2));
ws.close();
process.exit(failed.length ? 1 : 0);
