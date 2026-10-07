import assert from "node:assert/strict";
import { handleDeleteUser } from "./handler.ts";

function caller(role = "admin", authenticated = true) {
  return {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "actor" } : null }, error: authenticated ? null : {} }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }) }),
  };
}

function query(result) {
  const value = {
    select() { return value; }, eq() { return value; }, in() { return value; }, neq() { return value; },
    order() { return value; },
    maybeSingle: async () => (typeof result === "function" ? result() : result),
    then(resolve, reject) { return Promise.resolve(typeof result === "function" ? result() : result).then(resolve, reject); },
  };
  return value;
}

const cutoff = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Error shapes as produced by the installed supabase-js SDK.
const AUTH_404 = { name: "AuthApiError", message: "User not found", status: 404, code: "user_not_found" };
const AUTH_503 = { name: "AuthApiError", message: "Service unavailable", status: 503, code: "unexpected_failure" };
const AUTH_TIMEOUT = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };
const NETWORK_RPC = { message: "TypeError: fetch failed", details: "", hint: "", code: "ECONNRESET" };
const DB_ERROR = { message: "injected_failure", details: "", hint: "", code: "P0001" };

function admin(options = {}) {
  const state = {
    target: options.target === undefined ? { id: "target", display_name: "Target", email: "target@example.com", role: "user" } : options.target,
    counts: { futureCount: 1, futureDayoffCount: 1, retainedCount: 1, ...(options.counts || {}) },
    countsError: options.countsError || null,
    disableError: options.disableError || null, deleteError: options.deleteError || null, unbanError: options.unbanError || null,
    rpcMode: options.rpcMode || "ok", rpcError: options.rpcError || null, rpcThrows: options.rpcThrows || false,
    historyDeleted: options.historyDeleted || false, authLookup: options.authLookup || "exists",
    authDisabled: options.authDisabled || false, calls: [], rpcArgs: null, stateQueryError: options.stateQueryError || null,
    targetError: options.targetError || null, cleaned: false,
  };
  const profileGone = () => state.cleaned || state.target === null;
  return {
    state,
    from(table) {
      if (table === "profiles") return query(() => ({ data: profileGone() ? null : state.target, error: state.targetError || (state.calls.includes("rpc") ? state.stateQueryError : null) }));
      if (table === "user_history_labels") {
        return query(() => ({ data: state.cleaned || state.historyDeleted ? { deleted_at: new Date().toISOString() } : null, error: state.calls.includes("rpc") ? state.stateQueryError : null }));
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: { admin: {
      async updateUserById(_id, attrs) { state.calls.push(attrs.ban_duration); return { error: attrs.ban_duration === "none" ? state.unbanError : state.disableError }; },
      async deleteUser() { state.calls.push("delete"); return { error: state.deleteError }; },
      async getUserById() {
        switch (state.authLookup) {
          case "exists": return { data: { user: { banned_until: state.authDisabled ? "2099-01-01T00:00:00Z" : null } }, error: null };
          case "absent": return { data: { user: null }, error: AUTH_404 };
          case "503": return { data: { user: null }, error: AUTH_503 };
          case "timeout": return { data: { user: null }, error: AUTH_TIMEOUT };
          case "network": return { data: { user: null }, error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 } };
          case "throws": throw new TypeError("fetch failed");
          case "emptyNoError": return { data: { user: null }, error: null };
          case "plainNotFoundText": return { data: { user: null }, error: { message: "not found" } };
          default: throw new Error("bad authLookup");
        }
      },
    } },
    async rpc(name, args) {
      if (name === "delete_user_counts") {
        state.calls.push("counts");
        return { data: state.countsError ? null : { cutoffDate: cutoff, ...state.counts }, error: state.countsError };
      }
      assert.equal(name, "delete_user_data");
      state.calls.push("rpc"); state.rpcArgs = args;
      if (state.rpcMode === "lostCommitted") { state.cleaned = true; if (state.rpcThrows) throw new TypeError("fetch failed"); return { data: null, error: NETWORK_RPC }; }
      if (state.rpcMode === "lostNotCommitted") { if (state.rpcThrows) throw new TypeError("fetch failed"); return { data: null, error: NETWORK_RPC }; }
      if (state.rpcMode === "dbError") return { data: null, error: state.rpcError || DB_ERROR };
      state.cleaned = true;
      return { data: { status: "cleaned" }, error: null };
    },
  };
}

const deleteBody = { action: "delete", targetId: "target", confirmName: "Target", cutoffDate: cutoff, futureCount: 1, futureDayoffCount: 1, retainedCount: 1 };
const run = (a, body = deleteBody, c = caller()) => handleDeleteUser(c, a, body);

async function test401() { assert.equal((await handleDeleteUser(caller("user", false), admin(), { action: "list" })).status, 401); }
async function test403() { assert.equal((await handleDeleteUser(caller("user"), admin(), { action: "list" })).status, 403); }
async function test404() { assert.equal((await handleDeleteUser(caller(), admin({ target: null }), { action: "preview", targetId: "missing" })).status, 404); }
async function testSelfRejected() { const a = admin({ target: { id: "actor", display_name: "Me", role: "user" } }); assert.equal((await handleDeleteUser(caller(), a, { action: "preview", targetId: "actor" })).body.code, "SELF_DELETE"); }
async function testAdminRejected() { const a = admin({ target: { id: "target", display_name: "Boss", role: "admin" } }); assert.equal((await handleDeleteUser(caller(), a, { action: "preview", targetId: "target" })).body.code, "ROLE_FORBIDDEN"); }
async function testUnknownRoleRejected() { const a = admin({ target: { id: "target", display_name: "Odd", role: "other" } }); assert.equal((await handleDeleteUser(caller(), a, { action: "preview", targetId: "target" })).body.code, "ROLE_FORBIDDEN"); }
async function testNameExact() { for (const confirmName of ["target", " Target", "Target "]) { const r = await run(admin(), { ...deleteBody, confirmName }); assert.equal(r.body.code, "NAME_MISMATCH"); } }
async function testPreviewChanged409() { const r = await run(admin(), { ...deleteBody, futureCount: 99 }); assert.equal(r.status, 409); assert.equal(r.body.code, "PREVIEW_CHANGED"); assert.equal(r.body.preview.futureCount, 1); }
async function testDisableFailure() { const a = admin({ disableError: {} }); const r = await run(a); assert.equal(r.body.code, "DISABLE_FAILED"); assert.deepEqual(a.state.calls, ["counts", "876000h"]); }
async function testHardDeletePending() { const a = admin({ deleteError: { status: 500, message: "boom" } }); const r = await run(a); assert.equal(r.body.code, "AUTH_DELETE_PENDING"); }
async function testSuccess() { const a = admin(); const r = await run(a); assert.equal(r.status, 200); assert.equal(r.body.status, "deleted"); assert.deepEqual(a.state.calls, ["counts", "876000h", "rpc", "delete"]); }
async function testRetryAllowed() { const a = admin({ target: null, historyDeleted: true, authDisabled: true }); const r = await run(a, { action: "delete", targetId: "target", retry: true }); assert.equal(r.status, 200); assert.deepEqual(a.state.calls, ["delete"]); }
async function testRetryPreconditionRejected() { const r = await run(admin({ target: null, historyDeleted: true, authDisabled: false }), { action: "delete", targetId: "target", retry: true }); assert.equal(r.status, 409); assert.equal(r.body.code, "RETRY_NOT_ALLOWED"); }
async function testStatusCombinations() { const r = await run(admin({ target: null, historyDeleted: true, authDisabled: true }), { action: "status", targetId: "target" }); assert.equal(r.status, 200); assert.deepEqual(r.body, { profileExists: false, historyDeleted: true, authExists: true, authDisabled: true }); }
async function testDatabaseFailureIsNot404() { const r = await run(admin({ targetError: { message: "db down" } }), { action: "preview", targetId: "target" }); assert.equal(r.status, 500); }
async function testAlreadyCleanedRpcContinuesHardDelete() { const a = admin(); const orig = a.rpc.bind(a); a.rpc = async (name, args) => (name === "delete_user_data" ? (a.state.calls.push("rpc"), { data: { status: "already_cleaned" }, error: null }) : orig(name, args)); const r = await run(a); assert.equal(r.status, 200); assert.ok(a.state.calls.includes("delete")); }
async function testStatusActiveAndGoneCombinations() {
  const live = await run(admin({ authDisabled: false }), { action: "status", targetId: "target" });
  assert.deepEqual(live.body, { profileExists: true, historyDeleted: false, authExists: true, authDisabled: false });
  const gone = await run(admin({ target: null, historyDeleted: true, authLookup: "absent" }), { action: "status", targetId: "target" });
  assert.deepEqual(gone.body, { profileExists: false, historyDeleted: true, authExists: false, authDisabled: false });
  const retry = await run(admin({ target: null, historyDeleted: true, authLookup: "absent" }), { action: "delete", targetId: "target", retry: true });
  assert.equal(retry.body.code, "RETRY_NOT_ALLOWED");
}

// ---- M2: Auth lookup classification ----
async function testAuth404IsAbsent() { const r = await run(admin({ authLookup: "absent", target: null, historyDeleted: true }), { action: "status", targetId: "target" }); assert.equal(r.status, 200); assert.equal(r.body.authExists, false); }
async function unknownAuth(mode) {
  const r = await run(admin({ authLookup: mode, target: null, historyDeleted: true }), { action: "status", targetId: "target" });
  assert.equal(r.status, 503, mode); assert.equal(r.body.code, "AUTH_STATUS_UNKNOWN", mode);
  assert.equal(r.body.authExists, undefined, mode); assert.ok(!("profileExists" in r.body), mode);
  assert.match(String(r.body.error), /無法確認/);
}
async function testAuth503Unknown() { await unknownAuth("503"); }
async function testAuthTimeoutUnknown() { await unknownAuth("timeout"); }
async function testAuthNetworkErrorUnknown() { await unknownAuth("network"); }
async function testAuthThrownUnknown() { await unknownAuth("throws"); }
async function testAuthEmptyNoErrorUnknown() { await unknownAuth("emptyNoError"); }
async function testAuthPlainNotFoundTextIsNotEnough() { await unknownAuth("plainNotFoundText"); }
async function testRetryWithAuthUnknownDoesNotDelete() { const a = admin({ authLookup: "503", target: null, historyDeleted: true }); const r = await run(a, { action: "delete", targetId: "target", retry: true }); assert.equal(r.status, 503); assert.equal(r.body.code, "AUTH_STATUS_UNKNOWN"); assert.ok(!a.state.calls.includes("delete")); }

// ---- M3: RPC outcome classification ----
async function testExplicitDbErrorRollsBackAndUnbans() { const a = admin({ rpcMode: "dbError" }); const r = await run(a); assert.equal(r.status, 500); assert.equal(r.body.code, "CLEANUP_FAILED"); assert.deepEqual(a.state.calls, ["counts", "876000h", "rpc", "none"]); }
async function testExplicitDbErrorUnbanFailure() { const a = admin({ rpcMode: "dbError", unbanError: { message: "x" } }); const r = await run(a); assert.equal(r.body.code, "ROLLBACK_UNBAN_FAILED"); }
async function testDatabasePreviewRaceReturns409() { const a = admin({ rpcMode: "dbError", rpcError: { code: "P0001", message: "preview_changed" } }); const r = await run(a); assert.equal(r.status, 409); assert.equal(r.body.code, "PREVIEW_CHANGED"); assert.ok(a.state.calls.includes("none")); assert.ok(r.body.preview); }
async function testLostResponseCommittedContinues() {
  for (const rpcThrows of [false, true]) {
    const a = admin({ rpcMode: "lostCommitted", rpcThrows }); const r = await run(a);
    assert.equal(r.status, 200, `throws=${rpcThrows}`); assert.equal(r.body.status, "deleted");
    assert.ok(!a.state.calls.includes("none"), "must not unban when the transaction may have committed");
    assert.ok(a.state.calls.includes("delete"));
  }
}
async function testLostResponseNotCommittedStaysBanned() {
  for (const rpcThrows of [false, true]) {
    const a = admin({ rpcMode: "lostNotCommitted", rpcThrows }); const r = await run(a);
    assert.equal(r.status, 503, `throws=${rpcThrows}`); assert.equal(r.body.code, "DELETE_STATE_UNKNOWN");
    assert.deepEqual(a.state.calls, ["counts", "876000h", "rpc"]); assert.match(String(r.body.error), /停用/);
  }
}
async function testLostResponseAndStateQueryFailsStaysBanned() { const a = admin({ rpcMode: "lostNotCommitted", stateQueryError: { message: "db down" } }); const r = await run(a); assert.equal(r.body.code, "DELETE_STATE_UNKNOWN"); assert.ok(!a.state.calls.includes("none")); assert.ok(!a.state.calls.includes("delete")); }
async function testStuckBannedWithProfileStatusAndRetry() {
  const stuck = { target: { id: "target", display_name: "Target", email: "t@example.com", role: "user" }, authDisabled: true };
  const s = await run(admin(stuck), { action: "status", targetId: "target" });
  assert.deepEqual(s.body, { profileExists: true, historyDeleted: false, authExists: true, authDisabled: true });
  const a = admin(stuck); const r = await run(a);
  assert.equal(r.status, 200); assert.deepEqual(a.state.calls, ["counts", "876000h", "rpc", "delete"]);
  const withRetryFlag = admin(stuck); const r2 = await run(withRetryFlag, { ...deleteBody, retry: true });
  assert.equal(r2.status, 200);
}
async function testHardDeleteNotFoundIsSuccess() { const a = admin({ deleteError: AUTH_404 }); const r = await run(a); assert.equal(r.status, 200); assert.equal(r.body.status, "deleted"); }

// ---- M5 / M6: counts come from the database and include the dayoff count ----
async function testPreviewUsesDatabaseCounts() { const a = admin({ counts: { futureCount: 1200, futureDayoffCount: 7, retainedCount: 33 } }); const r = await run(a, { action: "preview", targetId: "target" }); assert.equal(r.status, 200); assert.deepEqual([r.body.futureCount, r.body.futureDayoffCount, r.body.retainedCount, r.body.cutoffDate], [1200, 7, 33, cutoff]); assert.equal(r.body.confirmName, "Target"); }
async function testPreviewCountsFailureIsNotZero() { const r = await run(admin({ countsError: { message: "db down" } }), { action: "preview", targetId: "target" }); assert.equal(r.status, 500); assert.equal(r.body.futureCount, undefined); }
async function testDayoffChange409() { const a = admin({ counts: { futureDayoffCount: 2 } }); const r = await run(a); assert.equal(r.status, 409); assert.equal(r.body.code, "PREVIEW_CHANGED"); assert.equal(r.body.preview.futureDayoffCount, 2); assert.ok(!a.state.calls.includes("876000h")); }
async function testMissingDayoffCountIs409() { const { futureDayoffCount, ...rest } = deleteBody; const r = await run(admin(), rest); assert.equal(r.status, 409); }
async function testRpcReceivesAllExpectedValues() { const a = admin(); await run(a); assert.deepEqual([a.state.rpcArgs.p_expected_future_count, a.state.rpcArgs.p_expected_dayoff_count, a.state.rpcArgs.p_expected_retained_count], [1, 1, 1]); }

// ---- m2: empty display_name is a missing value (JS rule must equal the SQL rule) ----
async function testEmptyDisplayNameFallsBackToEmail() {
  const t = { id: "target", display_name: "", email: "t@example.com", role: "user" };
  const p = await run(admin({ target: t }), { action: "preview", targetId: "target" }); assert.equal(p.body.confirmName, "t@example.com");
  assert.equal((await run(admin({ target: t }), { ...deleteBody, confirmName: "t@example.com" })).status, 200);
  assert.equal((await run(admin({ target: t }), { ...deleteBody, confirmName: "" })).body.code, "NAME_MISMATCH");
  const noEmail = { id: "target", display_name: "", email: "", role: "user" };
  assert.equal((await run(admin({ target: noEmail }), { action: "preview", targetId: "target" })).body.confirmName, "target");
}

const tests = [
  test401, test403, test404, testSelfRejected, testAdminRejected, testUnknownRoleRejected, testNameExact, testPreviewChanged409,
  testDisableFailure, testHardDeletePending, testSuccess, testRetryAllowed, testRetryPreconditionRejected, testStatusCombinations,
  testDatabaseFailureIsNot404, testAlreadyCleanedRpcContinuesHardDelete, testStatusActiveAndGoneCombinations,
  testAuth404IsAbsent, testAuth503Unknown, testAuthTimeoutUnknown, testAuthNetworkErrorUnknown, testAuthThrownUnknown,
  testAuthEmptyNoErrorUnknown, testAuthPlainNotFoundTextIsNotEnough, testRetryWithAuthUnknownDoesNotDelete,
  testExplicitDbErrorRollsBackAndUnbans, testExplicitDbErrorUnbanFailure, testDatabasePreviewRaceReturns409,
  testLostResponseCommittedContinues, testLostResponseNotCommittedStaysBanned, testLostResponseAndStateQueryFailsStaysBanned,
  testStuckBannedWithProfileStatusAndRetry, testHardDeleteNotFoundIsSuccess,
  testPreviewUsesDatabaseCounts, testPreviewCountsFailureIsNotZero, testDayoffChange409, testMissingDayoffCountIs409, testRpcReceivesAllExpectedValues,
  testEmptyDisplayNameFallsBackToEmail,
];
let passed = 0, failed = 0;
for (const test of tests) {
  try { await test(); passed++; console.log(`PASS ${test.name}`); }
  catch (error) { failed++; console.log(`FAIL ${test.name}: ${String(error.message).split("\n")[0]}`); }
}
console.log(`\n${passed}/${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
