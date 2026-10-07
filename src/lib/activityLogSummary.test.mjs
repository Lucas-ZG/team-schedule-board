// src/lib/activityLogSummary.test.mjs
// Node-based unit test for activityLogSummary.ts, run with:
//   node --experimental-strip-types src/lib/activityLogSummary.test.mjs
//
// This exists to verify the resilience fixes from the code-review round
// (malformed `detail` JSON must never throw; a log with no matching
// profile must never leak a raw UUID) without inserting permanent test
// rows into activity_logs -- that table has no UPDATE/DELETE policy for
// any role, so any row inserted through the real app or REST API to
// exercise these edge cases would be stuck there forever. Testing the
// same exported function directly is the only way to cover these cases
// without leaving irreversible junk data.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  summarizeActivityLog,
  buildWorkplaceLookup,
  redactUuids,
  resolveLogUserLabel,
  resolveDeleteUserTargetName,
  isDeleteUserEvent,
} from "./activityLogSummary.ts";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

function makeLog(overrides) {
  return {
    id: "log-1",
    user_id: "user-1",
    event_type: "update",
    target_table: "daily_status",
    target_id: "target-1",
    detail: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// -- Malformed `detail` shapes must never throw, and must fall back to a
// generic readable message instead of crashing the whole /admin/logs page.
function testMalformedDetailShapesNeverThrow() {
  const malformedDetails = [
    null,
    "just a string",
    42,
    ["array", "not", "object"],
    { before: "not an object", after: "not an object" },
    { before: { workplace_ids: { length: 3, evil: "object with a length prop" } } },
    { before: { workplace_ids: [1, 2, 3] } }, // numbers, not strings
    { before: { overtime_hours: "not a number" }, after: { overtime_hours: "also not" } },
    { before: null, after: undefined },
    {}, // valid object, no fields at all
  ];

  for (const detail of malformedDetails) {
    const log = makeLog({ event_type: "update", detail });
    let result;
    assert.doesNotThrow(() => {
      result = summarizeActivityLog(log, "Test User");
    }, `should not throw for detail: ${JSON.stringify(detail)}`);
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  }
  console.log("PASS testMalformedDetailShapesNeverThrow");
}

// -- create/delete event types with the same malformed shapes.
function testMalformedDetailAcrossEventTypes() {
  for (const eventType of ["create", "delete", "login"]) {
    for (const detail of [null, "garbage", { after: 123 }, { deleted: [] }]) {
      const log = makeLog({ event_type: eventType, detail });
      assert.doesNotThrow(() => summarizeActivityLog(log, "Test User"));
    }
  }
  console.log("PASS testMalformedDetailAcrossEventTypes");
}

// -- A well-formed diff still produces the expected sentence (regression
// guard so the hardening didn't break the happy path).
function testWellFormedUpdateStillWorks() {
  const log = makeLog({
    event_type: "update",
    detail: {
      work_date: "2026-08-22",
      before: { overtime_enabled: false, overtime_hours: 0, leave_hours: 0 },
      after: { overtime_enabled: true, overtime_hours: 2.5, leave_hours: 0 },
    },
  });
  const result = summarizeActivityLog(log, "ChangFeng.Li");
  assert.equal(result, "Overtime enabled, Overtime hours changed from 0 to 2.5");
  console.log("PASS testWellFormedUpdateStillWorks");
}

// -- The "no matching profile" fallback (page.tsx's profileLabel()) must
// never be a raw UUID -- verify that whatever the caller passes in as
// userLabel never gets treated specially or validated away, i.e. the
// summary function trusts its caller's label as already-sanitized, and
// separately confirm page.tsx's own fallback (tested by reading its
// source here since it can't be unit tested without a browser).
function testUnknownUserFallbackIsNotAUuid() {
  const source = fs.readFileSync(
    new URL("../app/admin/logs/page.tsx", import.meta.url),
    "utf8",
  );
  const match = source.match(/function profileLabel[\s\S]*?\n  \}/);
  assert.ok(match, "profileLabel function not found");
  assert.ok(/resolveLogUserLabel\(/.test(match[0]), "profileLabel must delegate to resolveLogUserLabel");
  assert.ok(!/actor_name/.test(match[0]), "profileLabel must not read detail.actor_name itself");
  assert.ok(
    !/return profile\?\.display_name \|\| profile\?\.email \|\| userId;/.test(match[0]),
    "profileLabel must not fall back to the raw userId",
  );
  // the non-identifying fallback is exercised behaviourally in testLabelFallbackOrder (resolveLogUserLabel)
  console.log("PASS testUnknownUserFallbackIsNotAUuid");
}

function testDeleteUserSummaryIsDistinct() {
  const log = makeLog({ event_type: "delete", target_table: "profiles", detail: { action: "delete_user", target_name: "Target" } });
  assert.equal(summarizeActivityLog(log, "Admin"), "Admin 刪除使用者 Target");
  console.log("PASS testDeleteUserSummaryIsDistinct");
}

// Regression test for the review finding: page.tsx used a truthiness check
// (`log.detail ? (...)`) to decide whether to show the expand toggle, which
// hides it for valid-but-falsey stored JSON (`false`, `0`, `""`). Since
// there's no component-test setup in this repo, this checks the source
// directly for the specific bug pattern and its fix, the same technique
// already used for testUnknownUserFallbackIsNotAUuid above.
function testDetailToggleUsesExplicitNullCheck() {
  const source = fs.readFileSync(
    new URL("../app/admin/logs/page.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/\{log\.detail \? \(/.test(source),
    "must not use a truthiness check on log.detail (hides the toggle for false/0/\"\")",
  );
  assert.ok(
    /\{log\.detail !== null \? \(/.test(source),
    "must use an explicit null check so falsey-but-valid JSON still gets a toggle",
  );
  console.log("PASS testDetailToggleUsesExplicitNullCheck");
}

// -- Regression test for the code-review finding: a missing/invalid
// `work_date` must not leave a dangling "for" with nothing after it.
function testMissingWorkDateProducesCompleteSentence() {
  const createLog = makeLog({
    event_type: "create",
    detail: { after: {} },
  });
  assert.equal(
    summarizeActivityLog(createLog, "Test User"),
    "Test User created a schedule record",
  );

  const deleteLog = makeLog({
    event_type: "delete",
    detail: { deleted: {} },
  });
  assert.equal(
    summarizeActivityLog(deleteLog, "Test User"),
    "Test User deleted the schedule record",
  );
  console.log("PASS testMissingWorkDateProducesCompleteSentence");
}

// Regression test for the review finding: a UUID-shaped `work_date` (any
// signed-in user can insert their own activity_logs row with arbitrary
// detail, so `work_date` is not guaranteed to actually be a date) must
// never appear in the rendered summary.
function testUuidShapedWorkDateIsNotEmbedded() {
  for (const eventType of ["create", "delete"]) {
    const log = makeLog({
      event_type: eventType,
      detail: { work_date: UUID, after: {}, deleted: {} },
    });
    const result = summarizeActivityLog(log, "Test User");
    assert.ok(!result.includes(UUID), `${eventType} summary must not embed a UUID-shaped work_date: ${result}`);
  }
  console.log("PASS testUuidShapedWorkDateIsNotEmbedded");
}

// redactUuids() is the final backstop applied to every summary string;
// verify it actually strips UUID-shaped substrings regardless of source.
function testRedactUuidsStripsUuidSubstrings() {
  assert.equal(redactUuids(`before ${UUID} after`), "before [id] after");
  assert.equal(redactUuids("no uuid here"), "no uuid here");
  console.log("PASS testRedactUuidsStripsUuidSubstrings");
}

function testWorkplaceLookupResolvesNames() {
  const lookup = buildWorkplaceLookup([
    { id: "wp-1", name: "K3", color: null, is_dayoff: false, is_active: true, created_at: "" },
  ]);
  const log = makeLog({
    event_type: "create",
    detail: {
      work_date: "2026-08-22",
      after: { workplace_ids: ["wp-1"], overtime_enabled: false, overtime_hours: 0, leave_hours: 0 },
    },
  });
  const result = summarizeActivityLog(log, "ChangFeng.Li", lookup);
  assert.equal(result, "ChangFeng.Li created a schedule record for 2026-08-22 (K3)");
  console.log("PASS testWorkplaceLookupResolvesNames");
}

// R3-M2: any signed-in user can insert their own activity_logs row with arbitrary detail, so detail.actor_name is
// only believable on the reserved delete-user event (which the database lets only delete_user_data() write).
const PROFILES = [
  { id: "admin-1", display_name: "Real Admin", email: "admin@x.test" },
  { id: "user-1", display_name: "Mallory", email: "m@x.test" },
];
const HISTORY = [{ user_id: "gone-1", display_name: "Gone Person" }];
function testForgedActorNameIsIgnoredOnOrdinaryEvents() {
  for (const event of ["login", "create", "update", "delete"]) {
    const log = makeLog({ user_id: "user-1", event_type: event, detail: { actor_name: "Real Admin", action: "delete_user", target_name: "Victim" } });
    assert.equal(resolveLogUserLabel(log, PROFILES, HISTORY), "Mallory", `${event} must resolve by user_id`);
  }
  // reserved shape but wrong table / wrong action is still ordinary
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "user-1", event_type: "delete", target_table: "daily_status", detail: { action: "delete_user", actor_name: "Real Admin" } }), PROFILES, HISTORY), "Mallory");
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "user-1", event_type: "delete", target_table: "profiles", detail: { action: "other", actor_name: "Real Admin" } }), PROFILES, HISTORY), "Mallory");
  assert.equal(isDeleteUserEvent(makeLog({ user_id: "user-1", event_type: "delete", target_table: "profiles", detail: { action: "other" } })), false);
}
function testReservedDeleteUserEventUsesSnapshot() {
  const log = makeLog({ user_id: "admin-1", event_type: "delete", target_table: "profiles", detail: { action: "delete_user", actor_name: "Admin Snapshot", target_name: "Victim" } });
  assert.equal(isDeleteUserEvent(log), true);
  assert.equal(resolveLogUserLabel(log, PROFILES, HISTORY), "Admin Snapshot");
  assert.equal(summarizeActivityLog(log, "Admin Snapshot"), "Admin Snapshot 刪除使用者 Victim");
  // reserved event without a usable snapshot falls back to the id-based lookup
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "admin-1", event_type: "delete", target_table: "profiles", detail: { action: "delete_user" } }), PROFILES, HISTORY), "Real Admin");
}
// R2-M1 marker rule: a name that stands for a user identity carries "（已刪除）" once the user is deleted; the ONLY exception is the
// target name inside the delete-user event summary ("Admin 刪除使用者 Gone Person"), because that event already says the person was deleted.
function testDeletedMarkerRule() {
  const history = [{ user_id: "gone-1", display_name: "gone.person", deleted_at: "2026-10-01T00:00:00Z" }];
  const fmt = (name) => name.replace(/(^|[._])([a-z])/g, (_, sep, ch) => (sep ? " " : "") + ch.toUpperCase());
  // (a) identity positions: User column label and any summary built from it keep the marker
  const label = resolveLogUserLabel(makeLog({ user_id: "gone-1" }), PROFILES, history);
  assert.equal(label, "gone.person（已刪除）");
  assert.equal(summarizeActivityLog(makeLog({ user_id: "gone-1", event_type: "login" }), label), "gone.person（已刪除） logged in");
  assert.match(summarizeActivityLog(makeLog({ user_id: "gone-1", event_type: "create", detail: { work_date: "2026-10-01", after: {} } }), label), /^gone\.person（已刪除） created a schedule record/);
  // (b) the exception: the delete-user event names its target without the marker, even though the target is deleted
  const event = makeLog({ user_id: "admin-1", event_type: "delete", target_table: "profiles", detail: { action: "delete_user", actor_name: "Real Admin", target_name: "gone.person" } });
  assert.equal(resolveDeleteUserTargetName(event, fmt), "Gone Person");
  assert.equal(summarizeActivityLog(event, "Real Admin", undefined, fmt), "Real Admin 刪除使用者 Gone Person");
  assert.ok(!summarizeActivityLog(event, "Real Admin", undefined, fmt).includes("（已刪除）"));
  // untrusted shapes (not the reserved event) yield no target name
  assert.equal(resolveDeleteUserTargetName(makeLog({ user_id: "admin-1", event_type: "delete", target_table: "daily_status", detail: { action: "delete_user", target_name: "x" } }), fmt), null);
}
function testLabelFallbackOrder() {
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "gone-1" }), PROFILES, HISTORY), "Gone Person");
  // a deleted user (profile gone, history label marked deleted) carries the same marker as the calendar
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "gone-1" }), PROFILES, [{ user_id: "gone-1", display_name: "ian.hong", deleted_at: "2026-10-01T00:00:00Z" }]), "ian.hong（已刪除）");
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "gone-1" }), PROFILES, [{ user_id: "gone-1", display_name: "ian.hong", deleted_at: null }]), "ian.hong");
  // names inside detail pass through the optional display formatter; without one they stay raw
  const deleteEvent = makeLog({ user_id: "admin-1", event_type: "delete", target_table: "profiles", detail: { action: "delete_user", target_name: "ian.hong" } });
  assert.equal(summarizeActivityLog(deleteEvent, "Admin"), "Admin 刪除使用者 ian.hong");
  assert.equal(summarizeActivityLog(deleteEvent, "Admin", undefined, (name) => name.toUpperCase()), "Admin 刪除使用者 IAN.HONG");
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "nobody" }), PROFILES, HISTORY), "已刪除使用者");
  assert.equal(resolveLogUserLabel(makeLog({ user_id: null }), PROFILES, HISTORY), "Unknown");
  assert.equal(resolveLogUserLabel(makeLog({ user_id: "user-1" }), [{ id: "user-1", display_name: "", email: "m@x.test" }], HISTORY), "m@x.test");
}

const tests = [
  testForgedActorNameIsIgnoredOnOrdinaryEvents,
  testReservedDeleteUserEventUsesSnapshot,
  testLabelFallbackOrder,
  testDeletedMarkerRule,
  testMalformedDetailShapesNeverThrow,
  testMalformedDetailAcrossEventTypes,
  testWellFormedUpdateStillWorks,
  testUnknownUserFallbackIsNotAUuid,
  testDetailToggleUsesExplicitNullCheck,
  testMissingWorkDateProducesCompleteSentence,
  testUuidShapedWorkDateIsNotEmbedded,
  testRedactUuidsStripsUuidSubstrings,
  testWorkplaceLookupResolvesNames,
  testDeleteUserSummaryIsDistinct,
];

let passed = 0;
for (const test of tests) {
  test();
  passed += 1;
}
console.log(`\n${passed}/${tests.length} tests passed`);
