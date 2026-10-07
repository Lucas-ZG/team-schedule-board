// Round-2 UI verification (local app + local Supabase only), driven through Chrome DevTools Protocol.
// Covers: M4 (409 -> cleared confirm + automatic re-preview; lost response / retry timeout -> status first),
// M7 (refresh failure message for calendar / OT / member queries; none on success), m3 (live profile with empty
// display_name), StatusModal read-only for a deleted user's history.
// Network faults are injected with CDP Fetch interception; server state is real (local stack).
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
eventHandlers.push(async (msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const p = msg.params; const req = p.request; const isResponseStage = p.responseStatusCode !== undefined || p.responseErrorReason !== undefined;
  try {
    if (req.method === "OPTIONS") { await send("Fetch.continueRequest", { requestId: p.requestId }); return; }
    if (isResponseStage) {
      if (dropAfter.has(p.requestId)) { dropAfter.delete(p.requestId); await send("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" }); }
      else await send("Fetch.continueResponse", { requestId: p.requestId });
      return;
    }
    const rule = rules.find((r) => r.match(req));
    if (!rule) { await send("Fetch.continueRequest", { requestId: p.requestId }); return; }
    rule.hits = (rule.hits || 0) + 1; seen.push(`${rule.name}:${req.method}:${req.url.split("?")[0].split("/").slice(-2).join("/")}`);
    if (rule.once) rules.splice(rules.indexOf(rule), 1);
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

// M4a: 409 -> message, confirmation cleared, preview refreshed automatically, second attempt succeeds
const targetA = await fixture("UI Race A");
await scenario("M4 409: cleared confirm + automatic re-preview + success after re-confirm", async () => {
  await reloadHome(); await openModal(); await selectTarget(targetA.name);
  await waitFor(`document.body.innerText.includes('將刪除未來排班：1 筆')`);
  await setInput("input", targetA.name); assert.equal((await buttonState("刪除使用者")).disabled, false);
  assert.ifError((await svc.from("daily_status").insert({ user_id: targetA.id, work_date: addDays(2), workplace_id: k3, workplace_ids: [k3] })).error);
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('資料已變更')`);
  await waitFor(`document.body.innerText.includes('將刪除未來排班：2 筆')`);
  assert.equal(await evaluate(`document.querySelector('input').value`), "", "confirmation must be cleared");
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='刪除使用者')`);
  assert.equal((await buttonState("刪除使用者")).disabled, true, "delete must be disabled until re-confirmed");
  await shot("r2-01-409-reconfirm");
  await setInput("input", targetA.name); assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`);
  assert.ok(!(await bodyText()).includes("畫面更新失敗"), "no refresh-failure message when the refresh succeeds");
  assert.equal((await svc.from("profiles").select("id").eq("id", targetA.id).maybeSingle()).data, null);
  await shot("r2-02-success-no-refresh-failure");
});

// M4b: the server completes but the response is lost -> UI asks status and reports success
const targetB = await fixture("UI Lost B");
await scenario("M4 lost response after commit: status checked, success shown", async () => {
  await reloadHome(); await openModal(); await selectTarget(targetB.name); await setInput("input", targetB.name);
  rules.push({ name: "drop-delete-response", action: "dropResponse", once: true, match: (req) => fnAction(req, "delete") });
  rules.push({ name: "status-seen", action: "continue", match: (req) => fnAction(req, "status") });
  seen.length = 0;
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 40000);
  assert.ok(seen.some((entry) => entry.startsWith("drop-delete-response")), "the delete response must have been dropped");
  assert.ok(seen.some((entry) => entry.startsWith("status-seen")), "the UI must query status after an unknown outcome");
  assert.equal((await svc.from("profiles").select("id").eq("id", targetB.id).maybeSingle()).data, null);
  assert.ok((await svc.auth.admin.getUserById(targetB.id)).error, "auth account really gone");
});

// M4c: pending retry, retry request times out -> status first -> still retryable -> real retry completes
const targetC = await fixture("UI Pending C");
await scenario("M4 retry timeout: status first, retry state kept, final retry completes", async () => {
  await reloadHome(); await openModal(); await selectTarget(targetC.name); await setInput("input", targetC.name);
  // make the real server state "data cleaned, account disabled, Auth account still present" (stuck state 2)
  const adminSession = (await createClient(supaUrl, anonKey).auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD })).data.session;
  const caller = createClient(supaUrl, anonKey, { global: { headers: { Authorization: `Bearer ${adminSession.access_token}` } }, auth: { persistSession: false } });
  const failingAuthDelete = createClient(supaUrl, serviceKey, { auth: { persistSession: false }, global: { fetch: async (input, init = {}) => (String(input).includes("/auth/v1/admin/users/") && (init.method || "GET").toUpperCase() === "DELETE" ? new Response("{}", { status: 503 }) : fetch(input, init)) } });
  const preview = (await handleDeleteUser(caller, svc, { action: "preview", targetId: targetC.id })).body;
  const stuck = await handleDeleteUser(caller, failingAuthDelete, { action: "delete", targetId: targetC.id, confirmName: targetC.name, cutoffDate: preview.cutoffDate, futureCount: preview.futureCount, futureDayoffCount: preview.futureDayoffCount, retainedCount: preview.retainedCount });
  assert.equal(stuck.body.code, "AUTH_DELETE_PENDING");
  // first click: server would answer 404 now, so answer what the original request would have said (AUTH_DELETE_PENDING)
  rules.push({ name: "pending-reply", action: "fulfill", status: 502, body: { code: "AUTH_DELETE_PENDING", error: "stub" }, once: true, match: (req) => fnAction(req, "delete") });
  rules.push({ name: "retry-timeout", action: "fail", once: true, match: (req) => fnAction(req, "delete") && fnBody(req, (b) => b.retry === true) });
  rules.push({ name: "status-seen", action: "continue", match: (req) => fnAction(req, "status") });
  seen.length = 0;
  assert.equal(await clickText("刪除使用者"), true);
  await waitFor(`document.body.innerText.includes('刪除未完成：帳號已停用、資料已清理')`); await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='重試完成刪除')`);
  await shot("r2-03-pending-retry");
  assert.equal(await clickText("重試完成刪除"), true);                      // this retry request is dropped (timeout)
  await waitFor(`document.body.innerText.includes('刪除未完成：帳號已停用、資料已清理') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='重試完成刪除' && !b.disabled)`, 30000);
  assert.ok(seen.some((entry) => entry.startsWith("retry-timeout")), "retry request must have timed out");
  assert.ok(seen.some((entry) => entry.startsWith("status-seen")), "status must be queried after the retry timeout");
  assert.ok(!(await bodyText()).includes("使用者已刪除成功。"), "must not show success while the account still exists");
  await shot("r2-04-after-retry-timeout-status");
  assert.equal(await clickText("重試完成刪除"), true);                      // real retry
  await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 30000);
  assert.ok((await svc.auth.admin.getUserById(targetC.id)).error, "auth account really gone after the retry");
});

// M7: refresh failure after a successful delete (calendar rows / OT range / member list)
const refreshCases = [
  ["calendar rows", (req) => req.method === "GET" && /\/rest\/v1\/daily_status\?/.test(req.url) && !req.url.includes("overtime_enabled")],
  ["OT range", (req) => req.method === "GET" && /\/rest\/v1\/daily_status\?/.test(req.url) && req.url.includes("overtime_enabled")],
  ["member list", (req) => req.method === "GET" && /\/rest\/v1\/profiles\?/.test(req.url)],
];
let caseNo = 0;
for (const [label, matcher] of refreshCases) {
  caseNo++; const t = await fixture(`UI Refresh ${caseNo}`, { ot: true });
  await scenario(`M7 refresh failure (${label}) -> "已刪除成功，畫面更新失敗"`, async () => {
    await reloadHome(); await openModal(); await selectTarget(t.name); await setInput("input", t.name);
    rules.push({ name: `block-${label}`, action: "fail", match: matcher });
    assert.equal(await clickText("刪除使用者"), true);
    await waitFor(`document.body.innerText.includes('已刪除成功，畫面更新失敗')`, 30000);
    const text = await bodyText();
    assert.ok(!text.includes("使用者已刪除成功。"), "no success toast when the refresh failed");
    assert.equal((await buttonState("重新整理頁面")).exists, true); assert.equal((await buttonState("刪除使用者")).exists, false, "no way to delete the same target again");
    assert.equal(await evaluate(`document.querySelector('input')===null`), true);
    if (label === "calendar rows") await shot("r2-05-refresh-failed");
    assert.equal((await svc.from("profiles").select("id").eq("id", t.id).maybeSingle()).data, null, "the account really was deleted");
  });
}

// m3: live profile with an empty display_name is shown by email, never as deleted
const blank = await fixture("UI Blank Live", { rows: [0], blankName: true });
await scenario("m3 live profile with empty display_name shows its email, not （已刪除）", async () => {
  await reloadHome(); await waitFor(`document.body.innerText.includes(${q(blank.email)})`);
  const text = await bodyText(); assert.ok(!text.includes(`${blank.email}（已刪除）`));
  await shot("r2-06-empty-display-name");
});

// StatusModal read-only for a deleted user's history (targetA was deleted above and kept its past/today rows)
await scenario("StatusModal: deleted user's history is view-only", async () => {
  await reloadHome(); await waitFor(`document.body.innerText.includes(${q(targetA.name + "（已刪除）")})`);
  assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${q(targetA.name + "（已刪除）")}));if(!b)return false;b.click();return true})()`), true);
  await waitFor(`document.body.innerText.includes('Edit member status')`); await sleep(500);
  const text = await bodyText(); assert.ok(text.includes("View only"), "view-only notice");
  const modal = await evaluate(`(()=>{const f=document.querySelector('fieldset');const sel=document.querySelector('form select');return {fieldsetDisabled:f.disabled,hasSave:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save'),hasDelete:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Delete'),memberSelectLabel:sel.options[sel.selectedIndex]?.textContent}})()`);
  assert.equal(modal.fieldsetDisabled, true); assert.equal(modal.hasSave, false); assert.equal(modal.hasDelete, false);
  assert.ok(String(modal.memberSelectLabel).includes("（已刪除）"), `member select shows the deleted user, got ${modal.memberSelectLabel}`);
  await shot("r2-07-status-modal-readonly"); await clickText("Cancel");
});

assert.equal(remoteSupabaseHits.length, 0, "the app must only talk to the local stack");
const failed = Object.entries(results).filter(([, v]) => v === "FAIL");
console.log(JSON.stringify({ results, onlyLocalSupabase: remoteSupabaseHits.length === 0 }, null, 2));
ws.close();
process.exit(failed.length ? 1 : 0);
