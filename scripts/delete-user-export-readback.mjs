// Round-3 R3-m3: really download the ExportModal and OTExportModal files for a deleted account and read them back
// (xlsx-js-style, already a dependency). Local app + local Supabase only; never prints keys.
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

// ---- R3-m3: download ExportModal / OTExportModal files for a deleted account and read the files back ----
import XLSX from "xlsx-js-style";
const exportDir = path.join(evidenceDir, "exports"); fs.mkdirSync(exportDir, { recursive: true });
for (const f of fs.readdirSync(exportDir)) fs.rmSync(path.join(exportDir, f));
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: exportDir, eventsEnabled: true });

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dateLabel = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const monthStart = today.slice(0, 8) + "01";
const lastDay = (() => { const d = new Date(`${today.slice(0, 8)}01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
const eachDate = (from, to) => { const out = []; for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };

// fixture: past (OT 1.5h), today (OT 2h), future (OT 3h; removed by the deletion). Offsets chosen to stay in the current month.
const name = `Export Gone ${String(stamp).slice(-5)}`;
const mail = `export-gone-${stamp}@local.test`;
const created = await svc.auth.admin.createUser({ email: mail, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name } });
assert.ifError(created.error); const gone = { id: created.data.user.id, name };
assert.ifError((await svc.from("profiles").update({ role: "user", display_name: name, email: mail }).eq("id", gone.id)).error);
const pastIso = addDays(-3), futureIso = addDays(2);
assert.ok(pastIso >= monthStart && futureIso <= lastDay, `fixture dates must be inside the exported month (${pastIso}..${futureIso} vs ${monthStart}..${lastDay})`);
assert.ifError((await svc.from("daily_status").insert([[-3, 1.5], [0, 2], [2, 3]].map(([offset, hours]) => ({ user_id: gone.id, work_date: addDays(offset), workplace_id: k3, workplace_ids: [k3], overtime_enabled: true, overtime_hours: hours })))).error);
const beforeRows = (await svc.from("daily_status").select("work_date,overtime_hours").eq("user_id", gone.id).order("work_date")).data;
console.log("DB before deletion:", JSON.stringify(beforeRows.map((r) => `${r.work_date}:${r.overtime_hours}h`)));

await reloadHome(); await openModal(); await selectTarget(gone.name); await setInput("input", gone.name);
assert.equal(await clickText("刪除使用者"), true);
await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 20000);
const dbRows = (await svc.from("daily_status").select("work_date,workplace_id,workplace_ids,overtime_enabled,overtime_hours").eq("user_id", gone.id).order("work_date")).data;
console.log("DB after deletion :", JSON.stringify(dbRows.map((r) => `${r.work_date}:${r.overtime_hours}h`)));
assert.deepEqual(dbRows.map((r) => r.work_date), [pastIso, today], "past and today kept, future removed in the database");
await reloadHome(); await waitFor(`document.body.innerText.includes(${q(gone.name + "（已刪除）")})`, 20000);

async function downloadAfter(label, click) {
  const known = new Set(fs.readdirSync(exportDir)); assert.equal(await click(), true, label);
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const fresh = fs.readdirSync(exportDir).filter((f) => !known.has(f) && f.endsWith(".xlsx") && !f.endsWith(".crdownload"));
    if (fresh.length) { await sleep(500); return path.join(exportDir, fresh[0]); }
    await sleep(300);
  }
  throw new Error(`${label}: no file downloaded`);
}
const sheetRows = (file) => { const wb = XLSX.readFile(file); return Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" })])); };
const report = { checks: {} };

// ---- ExportModal (schedule) ----
assert.equal(await clickText("Export"), true); await waitFor(`document.body.innerText.includes('Export Schedule')`);
const scheduleFile = await downloadAfter("schedule export", () => clickText("Export Excel")); await sleep(500); await clickText("Cancel");
const schedule = sheetRows(scheduleFile); const sch = schedule.Schedule; assert.ok(sch, "sheet 'Schedule' exists");
const deletedHeader = `${gone.name}（已刪除）`;
const col = sch[0].findIndex((cell) => cell === deletedHeader);
assert.ok(col >= 0, `deleted account name "${deletedHeader}" is a header cell`);
const days = eachDate(monthStart, lastDay);
const expectedCell = (iso) => { const rows = dbRows.filter((r) => r.work_date === iso); return rows.length ? "K3" : ""; };
let mismatches = [];
days.forEach((iso, i) => {
  const row = sch[i + 1]; if (!row) { mismatches.push(`${iso}: missing row`); return; }
  if (row[col] !== dateLabel(iso)) mismatches.push(`${iso}: date label ${row[col]}`);
  if (row[col + 1] !== expectedCell(iso)) mismatches.push(`${iso}: expected "${expectedCell(iso)}" got "${row[col + 1]}"`);
});
assert.deepEqual(mismatches, [], "every day of the deleted account's column matches the database");
const idx = (iso) => days.indexOf(iso) + 1;
assert.equal(sch[idx(pastIso)][col + 1], "K3", "past schedule kept"); assert.equal(sch[idx(today)][col + 1], "K3", "today's schedule kept"); assert.equal(sch[idx(futureIso)][col + 1], "", "future schedule absent");
const nonEmpty = sch.slice(1).filter((r) => r[col + 1] !== "").length; assert.equal(nonEmpty, 2);
report.checks.schedule = { file: path.basename(scheduleFile), header: deletedHeader, pastCell: sch[idx(pastIso)][col + 1], todayCell: sch[idx(today)][col + 1], futureCell: sch[idx(futureIso)][col + 1], nonEmptyCells: nonEmpty };
console.log("ExportModal read-back:", JSON.stringify(report.checks.schedule));

// ---- OTExportModal ----
assert.equal(await clickText("Export OT"), true); await waitFor(`document.body.innerText.includes('Export OT Records')`);
await sleep(1500);
const otFile = await downloadAfter("OT export", () => clickText("Export Excel")); await sleep(500); await clickText("Cancel");
const ot = sheetRows(otFile);
const expectedOtEntries = dbRows.filter((r) => r.overtime_enabled && Number(r.overtime_hours) > 0).map((r) => ({ date: r.work_date, hours: Number(r.overtime_hours) }));
const expectedTotal = expectedOtEntries.reduce((sum, e) => sum + e.hours, 0);
let found = null;
for (const [sheetName, rows] of Object.entries(ot)) {
  const c = (rows[0] || []).findIndex((cell) => cell === deletedHeader);
  if (c >= 0) found = { sheetName, rows, c };
}
assert.ok(found, `OT export contains "${deletedHeader}" (sheets: ${Object.keys(ot).join(", ")})`);
const entries = []; let totalCell = "";
for (const row of found.rows.slice(1)) { const label = row[found.c], hours = row[found.c + 1]; if (String(label).startsWith("Total:")) totalCell = label; else if (label) entries.push(`${label}=${hours}`); }
const expectedEntries = expectedOtEntries.map((e) => `${dateLabel(e.date)}=${e.hours.toFixed(1)}h`);
assert.deepEqual(entries, expectedEntries, "OT entries equal the database rows that remain");
assert.equal(totalCell, `Total: ${expectedTotal.toFixed(1)}h`, "OT total equals the database sum");
assert.ok(!entries.some((e) => e.startsWith(dateLabel(futureIso))), "future OT (3.0h, deleted) is not exported");
report.checks.ot = { file: path.basename(otFile), sheet: found.sheetName, header: deletedHeader, entries, total: totalCell, databaseTotalHours: expectedTotal, deletedFutureOtHours: 3 };
console.log("OTExportModal read-back:", JSON.stringify(report.checks.ot));
fs.writeFileSync(path.join(evidenceDir, "export_readback.json"), JSON.stringify(report, null, 2));

assert.equal(remoteSupabaseHits.length, 0, "the app must only talk to the local stack");
console.log(JSON.stringify({ exportReadback: "PASS", onlyLocalSupabase: true }));
ws.close();
process.exit(0);
