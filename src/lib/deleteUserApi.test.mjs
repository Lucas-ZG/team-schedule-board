import assert from "node:assert/strict";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { classifyFailure, interpretStatus, messageForCode, requiresStatusCheck, toDeleteUserError } from "./deleteUserApi.ts";

const http = (status, body) => new FunctionsHttpError(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const PREVIEW = { targetId: "t", confirmName: "T", cutoffDate: "2026-10-06", futureCount: 2, futureDayoffCount: 1, retainedCount: 3 };

async function testHttpErrorBodyIsParsed() {
  const e = await toDeleteUserError(http(409, { code: "PREVIEW_CHANGED", error: "資料已變更，請重新確認影響摘要。", preview: PREVIEW }));
  assert.equal(e.code, "PREVIEW_CHANGED"); assert.equal(e.httpStatus, 409); assert.deepEqual(e.preview, PREVIEW);
  assert.match(e.message, /重新確認/); assert.equal(classifyFailure(e), "preview-changed");
}
async function testStructuredCodesSurvive() {
  for (const code of ["ROLLBACK_UNBAN_FAILED", "AUTH_DELETE_PENDING", "DELETE_STATE_UNKNOWN", "AUTH_STATUS_UNKNOWN", "NAME_MISMATCH"]) {
    const e = await toDeleteUserError(http(500, { code, error: "x" })); assert.equal(e.code, code);
  }
}
async function testEveryBackendCodeHasChineseMessage() {
  const codes = ["SELF_DELETE", "ROLE_FORBIDDEN", "NAME_MISMATCH", "PREVIEW_CHANGED", "DISABLE_FAILED", "CLEANUP_FAILED", "ROLLBACK_UNBAN_FAILED",
    "AUTH_DELETE_PENDING", "RETRY_NOT_ALLOWED", "AUTH_STATUS_UNKNOWN", "DELETE_STATE_UNKNOWN"];
  for (const code of codes) {
    const text = messageForCode(code, 500, "internal sql detail: relation foo");
    assert.match(text, /[一-鿿]/, code); assert.ok(!/sql|relation|foo|service_role|stack/i.test(text), `${code} leaked: ${text}`);
  }
  assert.match(messageForCode(null, 401, null), /登入/); assert.match(messageForCode(null, 403, null), /權限|管理員/);
}
async function testUnparseableBodyFallsBack() {
  const e = await toDeleteUserError(http(500, "<html>oops</html>")); assert.equal(e.code, null); assert.match(e.message, /[一-鿿]/);
  assert.equal(classifyFailure(e), "uncertain");
}
async function testNetworkAndRelayAreUncertain() {
  const net = await toDeleteUserError(new FunctionsFetchError(new TypeError("fetch failed"))); assert.equal(net.network, true); assert.equal(classifyFailure(net), "uncertain");
  const abort = await toDeleteUserError(new FunctionsFetchError(new DOMException("aborted", "AbortError"))); assert.equal(classifyFailure(abort), "uncertain");
  const relay = await toDeleteUserError(new FunctionsRelayError(new Response("", { status: 502 }))); assert.equal(classifyFailure(relay), "uncertain");
  const thrown = await toDeleteUserError(new TypeError("fetch failed")); assert.equal(classifyFailure(thrown), "uncertain");
}
async function testClassification() {
  const cls = async (status, code) => classifyFailure(await toDeleteUserError(http(status, { code, error: "x" })));
  assert.equal(await cls(400, "NAME_MISMATCH"), "definitive"); assert.equal(await cls(400, "SELF_DELETE"), "definitive");
  assert.equal(await cls(500, "CLEANUP_FAILED"), "definitive"); assert.equal(await cls(502, "DISABLE_FAILED"), "definitive");
  assert.equal(await cls(409, "RETRY_NOT_ALLOWED"), "definitive"); assert.equal(await cls(403, undefined), "definitive");
  // R3-M1: these two codes never decide the screen by themselves; the status action does.
  assert.equal(await cls(502, "AUTH_DELETE_PENDING"), "uncertain"); assert.equal(await cls(503, "DELETE_STATE_UNKNOWN"), "uncertain");
  assert.equal(await cls(503, "AUTH_STATUS_UNKNOWN"), "uncertain"); assert.equal(await cls(500, undefined), "uncertain");
}
async function testInterpretStatus() {
  const s = (profileExists, historyDeleted, authExists, authDisabled) => interpretStatus({ profileExists, historyDeleted, authExists, authDisabled });
  assert.equal(s(false, true, false, false), "deleted");
  assert.equal(s(false, true, true, true), "pending-retry");
  assert.equal(s(true, false, true, true), "stuck-uncleaned");
  assert.equal(s(true, false, true, false), "not-deleted");
  assert.equal(s(false, true, true, false), "inconsistent");
  assert.equal(s(true, true, true, true), "inconsistent");
  assert.equal(s(false, false, false, false), "inconsistent");
}

async function testRequiresStatusCheck() {
  const err = async (status, code) => toDeleteUserError(http(status, { code, error: "x" }));
  // R3-M1: unknown outcomes always go through status first
  for (const code of ["AUTH_DELETE_PENDING", "DELETE_STATE_UNKNOWN", "AUTH_STATUS_UNKNOWN"]) assert.equal(requiresStatusCheck(await err(500, code), false), true, code);
  assert.equal(requiresStatusCheck(await toDeleteUserError(new FunctionsFetchError(new TypeError("fetch failed"))), false), true);
  assert.equal(requiresStatusCheck(await toDeleteUserError(new FunctionsFetchError(new DOMException("t", "TimeoutError"))), false), true);
  // a 404 on a retry (profile already gone) is not a definitive failure; on a first attempt it is
  assert.equal(requiresStatusCheck(await err(404, "TARGET_NOT_FOUND"), true), true);
  assert.equal(requiresStatusCheck(await err(404, undefined), true), true);
  assert.equal(requiresStatusCheck(await err(404, "TARGET_NOT_FOUND"), false), false);
  assert.equal(requiresStatusCheck(await err(409, "RETRY_NOT_ALLOWED"), false), true);
  // definitive answers stay definitive
  assert.equal(requiresStatusCheck(await err(400, "NAME_MISMATCH"), false), false);
  assert.equal(requiresStatusCheck(await err(400, "SELF_DELETE"), true), false);
  assert.equal(requiresStatusCheck(await err(409, "PREVIEW_CHANGED"), false), false);
}

const tests = [testRequiresStatusCheck, testHttpErrorBodyIsParsed, testStructuredCodesSurvive, testEveryBackendCodeHasChineseMessage, testUnparseableBodyFallsBack, testNetworkAndRelayAreUncertain, testClassification, testInterpretStatus];
let passed = 0, failed = 0;
for (const test of tests) {
  try { await test(); passed++; console.log(`PASS ${test.name}`); }
  catch (error) { failed++; console.log(`FAIL ${test.name}: ${String(error.message).split("\n")[0]}`); }
}
console.log(`\n${passed}/${tests.length} deleteUserApi tests passed`);
process.exit(failed ? 1 : 0);
