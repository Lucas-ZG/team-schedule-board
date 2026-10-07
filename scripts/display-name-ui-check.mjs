// Real-browser check of the display-name capitalization (local app + local Supabase only; keys and password stay in the process env).
// Prerequisite: scripts/setup-display-name-fixtures.mjs has run. Drives headless Chrome over CDP, deletes two fixture accounts
// through the real Delete User modal, downloads both exports and reads them back with xlsx-js-style.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { createClient } from "@supabase/supabase-js";
import { formatDisplayName } from "../src/lib/displayName.ts";

const debugUrl = process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9222";
const appUrl = process.env.LOCAL_APP_URL, evidenceDir = process.env.UI_EVIDENCE_DIR, password = process.env.UI_TEST_PASSWORD;
const supaUrl = process.env.LOCAL_SUPABASE_URL, serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
if (!appUrl || !evidenceDir || !password || !supaUrl || !serviceKey || !loopback.test(appUrl) || !loopback.test(supaUrl)) throw new Error("Requires loopback app + Supabase URLs and process-only inputs.");
fs.mkdirSync(evidenceDir, { recursive: true });
const svc = createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const packageVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const page = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let nextId = 0; const pending = new Map();
ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { const { ok, fail } = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result); } };
const send = (method, params = {}) => new Promise((ok, fail) => { const id = ++nextId; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expression.slice(0, 100)); return r.result.value; }
async function waitFor(expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { if (await evaluate(expression)) return; } catch { /* navigating */ } await sleep(150); }
  throw new Error(`timeout: ${expression}\n${JSON.stringify(await evaluate(`({href:location.href,text:document.body.innerText.slice(0,900)})`))}`);
}
async function shot(name) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(evidenceDir, `${name}.png`), Buffer.from(r.data, "base64")); }
const setInput = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${q(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${q(value)});e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${q(value)}}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const clickText = (text) => evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${q(text)});if(!e)return false;e.click();return true})()`);
const bodyText = () => evaluate("document.body.innerText");
const buttonState = (label) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${q(label)});return b?{exists:true,disabled:b.disabled}:{exists:false}})()`);
const results = {}; const observed = {};
async function scenario(name, fn) { try { await fn(); results[name] = "PASS"; console.log(`PASS ${name}`); } catch (error) { results[name] = "FAIL"; console.log(`FAIL ${name}: ${String(error.message).slice(0, 700)}`); } }
const RAW = ["ian.hong", "Lucas.ZG", "test_user.one", "gone.person", "ian.delete", "ian-b", "ian.a"];
const assertNoRawNames = (text, extra = []) => { for (const raw of [...RAW, ...extra]) assert.ok(!text.includes(raw), `raw name "${raw}" must not be visible; page text has it`); };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (days) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const emails = { admin: "lucas.zg@local.test", ian: "ian.hong@local.test", office: "office@local.test", viewer: "test.user.one@local.test", gone: "gone.person@local.test" };

async function login(email) {
  await send("Page.navigate", { url: `${appUrl}/login` });
  await waitFor(`document.querySelector('input[type=email]')!==null`); await sleep(3000);
  await setInput("input[type=email]", email); await setInput("input[type=password]", password); await sleep(250);
  assert.equal(await clickText("Login"), true);
  await waitFor(`location.pathname==='/' && document.body.innerText.includes('Workplace & Day Off Calendar')`);
  await sleep(1500);
}
async function logout() { await clickText("Logout"); await waitFor(`location.pathname==='/login'`); }
const headerText = () => evaluate(`document.querySelector('header').innerText`);
const todayCellNames = () => evaluate(`(()=>{const cell=[...document.querySelectorAll('div[role=button]')].find(x=>x.className.includes('ring-blue-500')&&!x.className.includes('ring-blue-400'));return cell?[...cell.querySelectorAll('span.truncate.font-medium')].map(x=>x.textContent):null})()`);
async function reloadHome() { await send("Page.navigate", { url: appUrl }); await waitFor(`document.body.innerText.includes('Workplace & Day Off Calendar')`); await sleep(2000); }
const profileNameFromDb = async (email) => {
  const user = (await svc.auth.admin.listUsers()).data.users.find((entry) => entry.email === email);
  return (await svc.from("profiles").select("display_name").eq("id", user.id).single()).data.display_name;
};

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
const remoteHits = [];
await send("Page.navigate", { url: appUrl }); await waitFor(`document.readyState==='complete'`); await evaluate(`localStorage.clear()`); await send("Network.clearBrowserCookies");

// ---- header + non-admin roles (viewer / user), each login also writes a login Log row ----
const viewerHeaders = {};
for (const [key, email, expected, raw] of [["viewer", emails.viewer, "Test User One", "test_user.one"], ["ian", emails.ian, "Ian Hong", "ian.hong"], ["office", emails.office, "Office", null], ["gone", emails.gone, "Gone Person", "gone.person"]]) {
  await scenario(`header shows "${expected}" for ${key}`, async () => {
    await login(email); const header = await headerText(); viewerHeaders[key] = header.replace(/\s+/g, " ");
    assert.ok(header.includes(expected), `header has ${expected}: ${header}`); if (raw) assert.ok(!header.includes(raw)); assert.ok(header.includes(`v${packageVersion}`), "version flag");
    if (key === "viewer") { assert.ok(!(await evaluate(`document.querySelector('[aria-label="Delete User"]')!==null`)), "viewer has no admin controls"); await shot("01-header-viewer"); }
    if (key === "ian") await shot("02-header-user");
    await logout();
  });
}
observed.nonAdminHeaders = viewerHeaders;

// ---- admin: header, calendar, OT summary, StatusModal ----
await login(emails.admin);
await scenario("header (admin) shows Lucas ZG and v" + packageVersion, async () => {
  const header = await headerText(); observed.adminHeader = header.replace(/\s+/g, " ");
  assert.ok(header.includes("Lucas ZG") && !header.includes("Lucas.ZG")); assert.ok(header.includes(`v${packageVersion}`));
  assert.equal(await evaluate(`[...document.querySelectorAll('header span')].find(x=>/^v\\d/.test(x.textContent))?.textContent`), `v${packageVersion}`);
  await shot("03-header-admin-calendar");
});
await scenario("calendar day cells and OT summary show capitalized names; raw names absent", async () => {
  const names = await todayCellNames(); observed.todayCellNamesBefore = names; assert.ok(names, "today's cell found");
  for (const expected of ["Lucas ZG", "Ian Hong", "Office", "Test User One", "Gone Person", "Ian Delete"]) assert.ok(names.includes(expected), `today's cell has ${expected}: ${JSON.stringify(names)}`);
  const text = await bodyText(); assertNoRawNames(text);
  observed.otSummaryLines = text.split("\n").filter((line) => /Ian Hong|Gone Person|Office|Lucas ZG|Test User One/.test(line) && /\d+(\.\d+)?\s*h/.test(line));
  assert.ok(observed.otSummaryLines.some((line) => line.includes("Ian Hong")), "OT summary lists Ian Hong");
  const leaveBox = await evaluate(`(()=>{const h=[...document.querySelectorAll('h2,h3,p,div')].find(x=>x.children.length===0&&x.textContent.trim()==='Monthly Leave Summary');return h?h.closest('section').innerText:''})()`);
  observed.leaveSummary = leaveBox.split("\n").filter(Boolean); assert.ok(/Ian Hong/.test(leaveBox) && !leaveBox.includes("ian.hong"), "Monthly Leave Summary lists Ian Hong: " + leaveBox);
  await shot("04-calendar-and-ot-summary");
});
await scenario("members with the same sort_order keep the RAW name order (ian-b before ian.a), not the formatted order", async () => {
  const names = await todayCellNames();
  const i = names.indexOf("Ian-b"), j = names.indexOf("Ian A"); assert.ok(i >= 0 && j >= 0, JSON.stringify(names));
  const rawOrder = ["ian-b", "ian.a"].sort((a, b) => a.localeCompare(b)); const formattedOrder = ["ian-b", "ian.a"].sort((a, b) => formatDisplayName(a).localeCompare(formatDisplayName(b)));
  observed.sortProof = { rawOrder, formattedOrder, displayed: [names[Math.min(i, j)], names[Math.max(i, j)]] };
  assert.notDeepEqual(rawOrder, formattedOrder, "fixture must distinguish raw sort from formatted sort");
  assert.deepEqual(i < j ? ["ian-b", "ian.a"] : ["ian.a", "ian-b"], rawOrder, "displayed order equals raw-name order");
  // the whole row: sort_order first, then raw name, exactly as DayCell sorts
  const profiles = (await svc.from("profiles").select("id,display_name,sort_order")).data; const live = names.map((shown) => profiles.find((p) => formatDisplayName(p.display_name) === shown)).filter(Boolean);
  const expectedOrder = [...live].sort((a, b) => (a.sort_order - b.sort_order) || a.display_name.localeCompare(b.display_name)).map((p) => formatDisplayName(p.display_name));
  assert.deepEqual(live.map((p) => formatDisplayName(p.display_name)), expectedOrder, "full order equals (sort_order, raw name)");
  observed.todayCellOrder = names;
});
await scenario("StatusModal: member dropdown and day list use capitalized names, option values stay ids", async () => {
  assert.equal(await evaluate(`(()=>{const cell=[...document.querySelectorAll('div[role=button]')].find(x=>x.className.includes('ring-blue-500')&&!x.className.includes('ring-blue-400'));cell.click();return true})()`), true);
  await waitFor(`document.body.innerText.includes('Edit member status')`);
  const options = await evaluate(`[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes('Lucas')))?.options.length ? [...[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes('Lucas'))).options].map(o=>({text:o.textContent,value:o.value})) : null`);
  observed.statusModalOptions = options.map((o) => o.text);
  for (const expected of ["Lucas ZG", "Ian Hong", "Office", "Test User One", "Gone Person", "Ian Delete", "Ian-b", "Ian A"]) assert.ok(options.some((o) => o.text === expected), `option ${expected}`);
  assert.ok(options.every((o) => /^[0-9a-f-]{36}$/.test(o.value)), "option values are user ids");
  const dbIds = new Set((await svc.from("profiles").select("id")).data.map((p) => p.id)); assert.ok(options.every((o) => dbIds.has(o.value)));
  const modal = await evaluate(`document.querySelector('section')?.innerText || document.body.innerText`); assertNoRawNames(modal);
  await shot("05-status-modal"); await clickText("Close").catch(() => {}); await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
});
// one real schedule edit as the admin (writes a "create" Log row for the Logs page)
await scenario("admin creates a schedule record through the modal (for the Logs page)", async () => {
  await reloadHome();
  const day = await evaluate(`(()=>{const cells=[...document.querySelectorAll('div[role=button]')].filter(c=>c.innerText.includes('No status'));const c=cells[0];if(!c)return null;const n=c.innerText.trim().split('\\n')[0];c.click();return n})()`);
  assert.ok(day, "an empty day exists"); await waitFor(`document.body.innerText.includes('Edit member status')`);
  await evaluate(`(()=>{const l=[...document.querySelectorAll('fieldset label')].find(x=>x.innerText.trim()==='K3');l.querySelector('input').click();return true})()`);
  assert.equal(await clickText("Save"), true); await waitFor(`!document.body.innerText.includes('Edit member status')`, 20000); await sleep(1000);
  observed.createdDay = day;
});

// ---- Delete User modal ----
await reloadHome();
const openDeleteModal = async () => { await evaluate(`document.querySelector('[aria-label="Delete User"]').click()`); await waitFor(`document.body.innerText.includes('刪除使用者')`); };
const selectTarget = async (label) => {
  await waitFor(`[...document.querySelectorAll('select option')].some(x=>x.textContent.includes(${q(label)}))`);
  await evaluate(`(()=>{const s=document.querySelector('select');const o=[...s.options].find(x=>x.textContent.includes(${q(label)}));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
};
await scenario("Delete User modal list is capitalized; confirmation text shown raw; typing the formatted name keeps the button disabled", async () => {
  await openDeleteModal(); await waitFor(`document.querySelectorAll('select option').length>2`);
  const options = await evaluate(`[...document.querySelectorAll('select option')].map(o=>o.textContent)`); observed.deleteModalOptions = options;
  for (const expected of ["Ian Hong · user", "Office · user", "Test User One · viewer", "Gone Person · user", "Ian Delete · user", "Ian-b · user", "Ian A · user"]) assert.ok(options.includes(expected), `option ${expected}: ${JSON.stringify(options)}`);
  assert.ok(!options.some((o) => o.includes("Lucas")), "admin is not listed");
  assertNoRawNames(await evaluate(`document.querySelector('select').innerText`));
  await selectTarget("Ian Delete"); await waitFor(`document.body.innerText.includes('輸入「ian.delete」確認')`);
  const confirmBlock = await evaluate(`document.querySelector('[data-testid=confirm-text]')?.textContent`);
  observed.confirmBlock = confirmBlock; assert.equal(confirmBlock, "輸入「ian.delete」確認", "raw confirmation text from the backend, not formatted");
  assert.ok((await bodyText()).includes("不會自動轉成首字母大寫"), "explanatory note");
  // R2-O1: only the name itself is "select-all"; the surrounding sentence is not, and a real copy/paste of the selection passes the match
  const center = (testId) => evaluate(`(()=>{const r=document.querySelector('[data-testid=${testId}]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const click = async ({ x, y }) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  await evaluate(`getSelection().removeAllRanges()`);
  await click(await center("confirm-name")); const selectedName = await evaluate(`getSelection().toString()`);
  observed.selectAll = { selectedByClickOnName: selectedName }; assert.equal(selectedName, "ian.delete", "one click selects exactly the name, not the surrounding sentence");
  await evaluate(`getSelection().removeAllRanges()`);
  const noteBox = await evaluate(`(()=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.includes('不會自動轉成首字母大寫'));const r=p.getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2}})()`);
  await click(noteBox); const selectedNote = await evaluate(`getSelection().toString()`);
  observed.selectAll.selectedByClickOnNote = selectedNote; assert.ok(!selectedNote.includes("ian.delete") && !selectedNote.includes("輸入"), "clicking the explanation does not select the name or the label text");
  await click(await center("confirm-name")); assert.equal(await evaluate(`getSelection().toString()`), "ian.delete");
  const key = (type, k, code, modifiers, commands) => send("Input.dispatchKeyEvent", { type, key: k, code, modifiers, commands });
  await key("keyDown", "c", "KeyC", 2, ["copy"]); await key("keyUp", "c", "KeyC", 2);
  await evaluate(`document.querySelector('input').focus()`); await key("keyDown", "v", "KeyV", 2, ["paste"]); await key("keyUp", "v", "KeyV", 2); await sleep(300);
  let pasted = await evaluate(`document.querySelector('input').value`);
  let pasteMode = "clipboard (Ctrl+C / Ctrl+V)";
  if (pasted !== "ian.delete") { await setInput("input", ""); await send("Input.insertText", { text: selectedName }); pasted = await evaluate(`document.querySelector('input').value`); pasteMode = "insertText of the selected string (clipboard unavailable in headless)"; }
  observed.selectAll.pasteMode = pasteMode; observed.selectAll.pastedValue = pasted; assert.equal(pasted, "ian.delete");
  assert.deepEqual(await buttonState("刪除使用者"), { exists: true, disabled: false }, "pasting the selected name passes the match");
  await shot("06b-delete-modal-select-name-paste");
  await setInput("input", "");
  await shot("06-delete-modal-confirm-raw");
  await setInput("input", "Ian Delete"); assert.deepEqual(await buttonState("刪除使用者"), { exists: true, disabled: true }, "formatted name must NOT enable the button");
  observed.typedFormatted = { typed: "Ian Delete", buttonDisabled: true }; await shot("07-delete-modal-formatted-typed-disabled");
  await setInput("input", "ian.delete"); assert.deepEqual(await buttonState("刪除使用者"), { exists: true, disabled: false }, "raw confirmation text enables the button");
  observed.typedRaw = { typed: "ian.delete", buttonDisabled: false }; await shot("08-delete-modal-raw-typed-enabled");
  assert.equal(await clickText("刪除使用者"), true); await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 25000);
  const rows = (await svc.from("daily_status").select("work_date").eq("user_id", (await svc.from("user_history_labels").select("user_id").eq("display_name", "ian.delete").single()).data.user_id)).data;
  observed.ianDeleteRowsAfter = rows.map((r) => r.work_date); assert.deepEqual([...observed.ianDeleteRowsAfter].sort(), [addDays(-3), today], "past leave day and today are kept, the future row is gone");
  assert.equal(await profileNameFromDb(emails.ian), "ian.hong", "stored name is still the raw value");
});
await scenario("delete gone.person through the modal (typing the raw name)", async () => {
  await reloadHome(); await openDeleteModal(); await selectTarget("Gone Person"); await waitFor(`document.body.innerText.includes('輸入「gone.person」確認')`);
  await setInput("input", "gone.person"); assert.equal(await clickText("刪除使用者"), true); await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`, 25000);
});

// ---- deleted users: calendar, OT summary, StatusModal option ----
await scenario("deleted users show \"Formatted Name（已刪除）\" in the calendar, OT summary and StatusModal", async () => {
  await reloadHome(); await waitFor(`document.body.innerText.includes('Gone Person（已刪除）')`, 20000);
  const names = await todayCellNames(); observed.todayCellNamesAfter = names;
  assert.ok(names.includes("Gone Person（已刪除）") && names.includes("Ian Delete（已刪除）"), JSON.stringify(names));
  const text = await bodyText(); assertNoRawNames(text);
  assert.ok(!text.includes("Gone Person（已刪除）（已刪除）"));
  observed.otSummaryAfterDelete = text.split("\n").filter((line) => line.includes("（已刪除）") || /Gone Person/.test(line));
  await shot("09-calendar-deleted-users");
  // open today's modal, then the deleted user's own entry: the Member select must show the deleted account
  await evaluate(`[...document.querySelectorAll('div[role=button]')].find(x=>x.className.includes('ring-blue-500')&&!x.className.includes('ring-blue-400')).click()`);
  await waitFor(`document.body.innerText.includes('Edit member status')`);
  assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('section button')].find(x=>x.innerText.includes('Gone Person（已刪除）'));if(!b)return false;b.click();return true})()`), true);
  await sleep(500);
  const selected = await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes('Lucas')));return s.options[s.selectedIndex].textContent})()`);
  observed.statusModalDeletedSelection = selected; assert.equal(selected, "Gone Person（已刪除）");
  await shot("10-status-modal-deleted-user");
});

// ---- R3-M1: Monthly Leave Summary with deleted users, and BatchStatusModal ----
await scenario("Monthly Leave Summary keeps deleted users' PAST leave as \"Formatted Name（已刪除）\" with the right hours (future leave is gone)", async () => {
  await reloadHome(); await waitFor(`document.body.innerText.includes('Monthly Leave Summary')`, 20000);
  const ids = Object.fromEntries((await svc.from("user_history_labels").select("user_id,display_name").not("deleted_at", "is", null)).data.map((l) => [l.display_name, l.user_id]));
  const leaveRows = (await svc.from("daily_status").select("user_id,work_date,leave_hours").gt("leave_hours", 0).in("user_id", Object.values(ids))).data;
  const sum = (name) => leaveRows.filter((r) => r.user_id === ids[name]).reduce((total, r) => total + Number(r.leave_hours), 0);
  observed.leaveDb = { gonePersonRemaining: leaveRows.filter((r) => r.user_id === ids["gone.person"]).map((r) => `${r.work_date}:${r.leave_hours}h`), ianDeleteRemaining: leaveRows.filter((r) => r.user_id === ids["ian.delete"]).map((r) => `${r.work_date}:${r.leave_hours}h`) };
  assert.equal(sum("gone.person"), 4, "only the past 4h leave of gone.person is left in the database (future 8h removed by the deletion)"); assert.equal(sum("ian.delete"), 8);
  assert.ok(leaveRows.every((r) => r.work_date <= today), "no future leave remains");
  const box = await evaluate(`(()=>{const h=[...document.querySelectorAll('h3')].find(x=>x.textContent.trim()==='Monthly Leave Summary');return h?h.closest('section').innerText:''})()`);
  const lines = box.split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean); observed.leaveSummaryAfterDelete = lines;
  assert.ok(lines.includes("Gone Person（已刪除） : 4h"), "deleted user row with correct hours: " + JSON.stringify(lines));
  assert.ok(lines.includes("Ian Delete（已刪除） : 1 day"), JSON.stringify(lines)); assert.ok(lines.includes("Ian Hong : 1 day"), "live user row unchanged");
  for (const raw of ["gone.person", "ian.delete", "ian.hong"]) assert.ok(!box.includes(raw), `raw ${raw} not in the leave summary`);
  assert.ok(!box.includes("（已刪除）（已刪除）"));
  await shot("12-leave-summary-deleted-users");
});
await scenario("BatchStatusModal: Member dropdown shows formatted names (live members only, ids as values)", async () => {
  await reloadHome(); assert.equal(await clickText("Multi-select"), true);
  const picked = await evaluate(`(()=>{const c=[...document.querySelectorAll('div[role=button]')].find(x=>x.innerText.includes('No status'));if(!c)return false;c.click();return true})()`); assert.equal(picked, true, "an empty day was selected");
  await waitFor(`!document.querySelector('button[disabled]') || [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Apply to selected dates')&&!b.disabled)`);
  assert.equal(await clickText("Apply to selected dates"), true); await waitFor(`document.body.innerText.includes('Apply status to selected dates')`);
  const options = await evaluate(`(()=>{const s=[...document.querySelectorAll('section select')].find(s=>[...s.options].some(o=>o.textContent.includes('Lucas')));return [...s.options].map(o=>({text:o.textContent,value:o.value}))})()`);
  observed.batchModalOptions = options.map((o) => o.text);
  const expected = ["Lucas ZG", "Ian Hong", "Office", "Test User One", "Ian-b", "Ian A"];
  assert.deepEqual(options.map((o) => o.text), expected, "formatted live members in (sort_order, raw name) order");
  assert.ok(options.every((o) => !o.text.includes("（已刪除）")), "BatchStatusModal receives live profiles only: no deleted users are listed, so no marker applies");
  const profiles = (await svc.from("profiles").select("id,display_name")).data; assert.ok(options.every((o) => { const p = profiles.find((x) => x.id === o.value); return p && formatDisplayName(p.display_name) === o.text; }), "values are ids of the matching raw profiles");
  assertNoRawNames(await evaluate(`document.querySelector('section').innerText`)); await shot("13-batch-status-modal");
  assert.equal(await clickText("Cancel"), true);
});

// ---- Logs page ----
await scenario("Logs page (R2-M1 rule): deleted user's identity positions carry the marker; the delete-user event's target does not", async () => {
  await reloadHome(); await send("Page.navigate", { url: `${appUrl}/admin/logs` });
  await waitFor(`document.body.innerText.includes('刪除使用者')`, 25000); await sleep(1500);
  const rows = await evaluate(`[...document.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].slice(0,5).map(td=>td.innerText.split('\\n')[0].trim()))`);
  observed.logsRows = rows.map((r) => `${r[0]} | ${r[1]} | ${r[3]} | ${r[4]}`);
  const text = rows.map((r) => r.join(" | ")).join("\n"); assertNoRawNames(text);
  const find = (needle) => rows.find((r) => r.join(" | ").includes(needle));
  assert.ok(find("Lucas ZG | Login"), "admin login row"); assert.ok(find("Ian Hong | Login"), "user login row"); assert.ok(find("Test User One | Login"), "viewer login row");
  assert.ok(rows.some((r) => r[0] === "Gone Person（已刪除）" && r[1] === "Login"), "deleted user's old login row is shown with the marker");
  // rule (a): identity positions of a deleted user -> marker.  rule (b), the single exception: the delete-user event summary names its target WITHOUT the marker.
  const ruleA = rows.find((r) => r[0] === "Gone Person（已刪除）" && r[1] === "Login"); const ruleB = rows.find((r) => r[0] === "Lucas ZG" && r[4] === "Lucas ZG 刪除使用者 Gone Person");
  observed.logsRule = { a_userColumnAndSummary: ruleA && `${ruleA[0]} | ${ruleA[4]}`, b_deleteEventSummary: ruleB && ruleB[4] };
  assert.ok(ruleA && ruleA[4] === "Gone Person（已刪除） logged in", "(a) marker in the User column and in the summary of the deleted user's other event");
  assert.ok(ruleB && !ruleB[4].includes("（已刪除）"), "(b) delete-user event summary: target has no marker");
  assert.ok(rows.some((r) => r[0] === "Lucas ZG" && r[4] === "Lucas ZG 刪除使用者 Ian Delete"));
  assert.ok(rows.some((r) => r[0] === "Lucas ZG" && /^Lucas ZG created a schedule record/.test(r[4])), "ordinary create event: " + JSON.stringify(rows.filter((r) => r[1] === "Create")));
  await shot("11-logs-page");
  // the raw JSON toggle stays raw by design (it is the stored value)
  assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='View details'&&x.closest('tr').innerText.includes('刪除使用者'));b.click();return true})()`), true);
  await sleep(400); const raw = await evaluate(`[...document.querySelectorAll('pre')].map(p=>p.innerText).find(t=>t.includes('target_name'))||''`);
  observed.rawJsonStaysRaw = /"target_name": "(gone\.person|ian\.delete)"/.test(raw); assert.ok(observed.rawJsonStaysRaw, raw);
});

// ---- exports (read back with xlsx-js-style) ----
const exportDir = path.join(evidenceDir, "exports"); fs.mkdirSync(exportDir, { recursive: true });
for (const f of fs.readdirSync(exportDir)) fs.rmSync(path.join(exportDir, f));
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: exportDir, eventsEnabled: true });
async function downloadAfter(label, click) {
  const known = new Set(fs.readdirSync(exportDir)); assert.equal(await click(), true, label);
  const start = Date.now();
  while (Date.now() - start < 30000) { const fresh = fs.readdirSync(exportDir).filter((f) => !known.has(f) && f.endsWith(".xlsx")); if (fresh.length) { await sleep(500); return path.join(exportDir, fresh[0]); } await sleep(300); }
  throw new Error(`${label}: no file downloaded`);
}
const sheetRows = (file) => { const wb = XLSX.readFile(file); return Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" })])); };
await reloadHome();
await scenario("ExportModal: header names are capitalized (deleted users carry the marker), history kept", async () => {
  assert.equal(await clickText("Export"), true); await waitFor(`document.body.innerText.includes('Export Schedule')`);
  const file = await downloadAfter("schedule export", () => clickText("Export Excel")); await sleep(500); await clickText("Cancel");
  const sheet = sheetRows(file).Schedule; assert.ok(sheet);
  const header = sheet[0].filter((cell) => cell !== ""); observed.scheduleHeader = header;
  for (const expected of ["Lucas ZG", "Ian Hong", "Office", "Test User One", "Gone Person（已刪除）", "Ian Delete（已刪除）", "Ian-b", "Ian A"]) assert.ok(header.includes(expected), `header ${expected}: ${JSON.stringify(header)}`);
  for (const raw of RAW) assert.ok(!header.some((cell) => String(cell).includes(raw)), `raw ${raw} not in header`);
  const col = sheet[0].indexOf("Gone Person（已刪除）"); const kept = sheet.slice(1).filter((r) => r[col + 1] !== "").length;
  observed.scheduleGonePersonCells = kept; assert.equal(kept, 3, "gone.person's three past/today rows (leave, OT, today) are still in the export; the two future rows are gone");
  const ianCol = sheet[0].indexOf("Ian Hong"); assert.ok(sheet.slice(1).some((r) => r[ianCol + 1] !== ""), "live user's data present");
  // order of headers = (sort_order, raw name) with deleted users last
  const profiles = (await svc.from("profiles").select("display_name,sort_order")).data;
  const expectedLive = [...profiles].sort((a, b) => (a.sort_order - b.sort_order) || a.display_name.localeCompare(b.display_name)).map((p) => formatDisplayName(p.display_name));
  assert.deepEqual(header.filter((h) => !String(h).includes("（已刪除）")), expectedLive, "export column order equals (sort_order, raw name)");
  observed.scheduleFile = path.basename(file);
});
await scenario("OTExportModal: member names are capitalized (deleted users carry the marker)", async () => {
  assert.equal(await clickText("Export OT"), true); await waitFor(`document.body.innerText.includes('Export OT Records')`); await sleep(1500);
  const preview = await evaluate(`(()=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.includes(' · '));return p?p.textContent:''})()`); observed.otPreviewLine = preview;
  assertNoRawNames(preview);
  const file = await downloadAfter("OT export", () => clickText("Export Excel")); await sleep(500); await clickText("Cancel");
  const sheets = sheetRows(file); const headers = Object.values(sheets).flatMap((rows) => (rows[0] || []).filter((c) => c !== "")); observed.otHeaders = headers;
  for (const expected of ["Ian Hong", "Gone Person（已刪除）"]) assert.ok(headers.includes(expected), `OT header ${expected}: ${JSON.stringify(headers)}`);
  for (const raw of RAW) assert.ok(!headers.some((cell) => String(cell).includes(raw)), `raw ${raw} not in OT header`);
  observed.otFile = path.basename(file);
});

// ---- the database still holds the raw values ----
await scenario("database keeps the raw names (read back)", async () => {
  const rows = (await svc.from("profiles").select("display_name,email")).data; const labels = (await svc.from("user_history_labels").select("display_name,deleted_at")).data;
  observed.dbProfileNames = rows.map((r) => r.display_name).sort(); observed.dbDeletedLabels = labels.filter((l) => l.deleted_at).map((l) => l.display_name).sort();
  for (const raw of ["ian.hong", "Lucas.ZG", "test_user.one", "Office"]) assert.ok(rows.some((r) => r.display_name === raw), `profiles.display_name ${raw}`);
  assert.deepEqual(observed.dbDeletedLabels, ["gone.person", "ian.delete"]);
});
const failed = Object.entries(results).filter(([, v]) => v !== "PASS");
fs.writeFileSync(path.join(evidenceDir, "display_name_ui_results.json"), JSON.stringify({ results, observed }, null, 2));
console.log(`\n${Object.keys(results).length - failed.length}/${Object.keys(results).length} scenarios passed`);
ws.close(); process.exit(failed.length ? 1 : 0);
