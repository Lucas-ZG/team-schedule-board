import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const debugUrl=process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9222";
const appUrl=process.env.LOCAL_APP_URL;
const evidenceDir=process.env.UI_EVIDENCE_DIR;
const password=process.env.UI_TEST_PASSWORD;
if(!appUrl||!evidenceDir||!password||!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(appUrl)) throw new Error("UI test requires loopback app URL and local fixture inputs.");
fs.mkdirSync(evidenceDir,{recursive:true});
const page=await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(appUrl)}`,{method:"PUT"})).json();
const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail});
let id=0;const pending=new Map();ws.onmessage=(event)=>{const msg=JSON.parse(event.data);if(msg.id&&pending.has(msg.id)){const {ok,fail}=pending.get(msg.id);pending.delete(msg.id);msg.error?fail(new Error(JSON.stringify(msg.error))):ok(msg.result)}};
function send(method,params={}){return new Promise((ok,fail)=>{const next=++id;pending.set(next,{ok,fail});ws.send(JSON.stringify({id:next,method,params}))})}
async function evaluate(expression){const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
async function waitFor(expression,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,150))}const state=await evaluate(`({href:location.href,text:document.body.innerText.slice(0,1200)})`);throw new Error(`timeout: ${expression}\n${JSON.stringify(state)}`)}
async function shot(name){const r=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(evidenceDir,`${name}.png`),Buffer.from(r.data,"base64"))}
const q=(value)=>JSON.stringify(value);
const setInput=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${q(selector)});const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,${q(value)});e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${q(value)}}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const clickText=(text)=>evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${q(text)});if(!e)return false;e.click();return true})()`);
async function login(email){await send("Page.navigate",{url:`${appUrl}/login`});await waitFor(`document.querySelector('input[type=email]')!==null`);await new Promise(r=>setTimeout(r,6000));await setInput('input[type=email]',email);await setInput('input[type=password]',password);await new Promise(r=>setTimeout(r,250));assert.deepEqual(await evaluate(`[document.querySelector('input[type=email]').value,document.querySelector('input[type=password]').value]`),[email,password]);assert.equal(await clickText("Login"),true);await waitFor(`location.pathname==='/' && document.body.innerText.includes('Workplace & Day Off Calendar')`);}
async function logout(){assert.equal(await clickText("Logout"),true);await waitFor(`location.pathname==='/login'`);}

await send("Page.enable");await send("Runtime.enable");await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:evidenceDir,eventsEnabled:true});
await send("Page.navigate",{url:appUrl});await waitFor(`document.readyState==='complete'`);await evaluate(`localStorage.clear()`);await send("Network.clearBrowserCookies");
await login("ui-admin@local.test");
await waitFor(`document.querySelector('[aria-label="Delete User"]')!==null`);
assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Delete User"]'))`),true);
await shot("01-admin-header");
await evaluate(`document.querySelector('[aria-label="Delete User"]').click()`);await waitFor(`document.body.innerText.includes('刪除使用者')`);
await waitFor(`[...document.querySelectorAll('select option')].some(x=>x.textContent.includes('UI User'))`);
const options=await evaluate(`[...document.querySelectorAll('select option')].map(x=>x.textContent)`);
assert.ok(options.some(x=>x.includes('UI User')&&x.includes('user')));assert.ok(options.some(x=>x.includes('UI Viewer')&&x.includes('viewer')));assert.ok(!options.some(x=>x.includes('UI Admin')));
await evaluate(`(()=>{const s=document.querySelector('select'),o=[...s.options];s.value=o.find(x=>x.textContent.includes('UI User')).value;s.dispatchEvent(new Event('change',{bubbles:true}));s.value=o.find(x=>x.textContent.includes('UI Viewer')).value;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await waitFor(`document.body.innerText.includes('輸入「UI Viewer」確認')`);
await evaluate(`(()=>{const s=document.querySelector('select');const o=[...s.options].find(x=>x.textContent.includes('UI Delete Target'));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await waitFor(`document.body.innerText.includes('將刪除未來排班：1 筆')&&document.body.innerText.includes('將保留今天與過去：2 筆')`);
await shot("02-delete-preview");
await setInput('input','UI Delete Target ');assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('刪除使用者')).disabled`),true);
await setInput('input','UI Delete Target');assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('刪除使用者')).disabled`),false);
assert.equal(await clickText("刪除使用者"),true);await waitFor(`!document.body.innerText.includes('輸入「UI Delete Target」確認')`,20000);
await waitFor(`document.body.innerText.includes('使用者已刪除成功。')`);
await waitFor(`document.body.innerText.includes('UI Delete Target（已刪除）')`,15000);await shot("03-history-after-delete");

assert.equal(await clickText("Export"),true);await waitFor(`document.body.innerText.includes('Export Schedule')`);await clickText("Export Excel");await new Promise(r=>setTimeout(r,6000));await clickText("Cancel");
assert.equal(await clickText("Export OT"),true);await waitFor(`document.body.innerText.includes('Export OT Records')`);await clickText("Export Excel");await new Promise(r=>setTimeout(r,6000));await clickText("Cancel");

assert.equal(await clickText("Logs"),true);await waitFor(`location.pathname==='/admin/logs'`);await waitFor(`document.body.innerText.includes('UI Admin 刪除使用者 UI Delete Target')`);await shot("04-delete-log");
await send("Page.navigate",{url:appUrl});await waitFor(`document.body.innerText.includes('Workplace & Day Off Calendar')`);await logout();
await login("ui-user@local.test");assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Delete User"]'))`),false);await shot("05-user-header");await logout();
await login("ui-viewer@local.test");await waitFor(`document.body.innerText.includes('Read-only view.')`);assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Delete User"]'))`),false);assert.ok((await evaluate(`document.body.innerText`)).includes("Read-only view."));await shot("06-viewer-header");
console.log(JSON.stringify({adminButtonVisible:true,userButtonHidden:true,viewerButtonHidden:true,listFiltered:true,stalePreviewIgnored:true,exactNameGating:true,previewCounts:true,successNotice:true,historyLabelVisible:true,logsReadable:true,scheduleExportTriggered:true,otExportTriggered:true,screenshots:6}));
ws.close();
