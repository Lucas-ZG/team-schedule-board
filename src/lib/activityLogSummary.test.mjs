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
  assert.equal(result, "加班狀態變更為 開啟、加班時數從 0 改為 2.5 小時");
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
  const fnBody = match[0];
  assert.ok(
    !/return profile\?\.display_name \|\| profile\?\.email \|\| userId;/.test(fnBody),
    "profileLabel must not fall back to the raw userId",
  );
  assert.ok(
    /Unknown user/.test(fnBody),
    "profileLabel must fall back to a non-identifying label",
  );
  console.log("PASS testUnknownUserFallbackIsNotAUuid");
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
  assert.equal(result, "ChangFeng.Li 建立了 2026-08-22 的排班紀錄（K3）");
  console.log("PASS testWorkplaceLookupResolvesNames");
}

const tests = [
  testMalformedDetailShapesNeverThrow,
  testMalformedDetailAcrossEventTypes,
  testWellFormedUpdateStillWorks,
  testUnknownUserFallbackIsNotAUuid,
  testDetailToggleUsesExplicitNullCheck,
  testUuidShapedWorkDateIsNotEmbedded,
  testRedactUuidsStripsUuidSubstrings,
  testWorkplaceLookupResolvesNames,
];

let passed = 0;
for (const test of tests) {
  test();
  passed += 1;
}
console.log(`\n${passed}/${tests.length} tests passed`);
