import assert from "node:assert/strict";
import { memberDisplayName, resolveStatusMemberName } from "./memberLabel.ts";

const label = (display_name, deleted_at = null) => ({ user_id: "u1", display_name, deleted_at });

function testNameFallbackOrder() {
  assert.equal(memberDisplayName({ id: "u1", display_name: "Ann", email: "a@x.com" }), "Ann");
  assert.equal(memberDisplayName({ id: "u1", display_name: "", email: "a@x.com" }), "a@x.com");
  assert.equal(memberDisplayName({ id: "u1", display_name: null, email: "a@x.com" }), "a@x.com");
  assert.equal(memberDisplayName({ id: "u1", display_name: "", email: "" }), "u1");
  assert.equal(memberDisplayName({ id: "u1", display_name: " ", email: "a@x.com" }), " ");
}
function testExistingProfileWithEmptyNameIsNotMarkedDeleted() {
  const status = { profile: { id: "u1", display_name: "", email: "a@x.com" }, historyLabel: label("a@x.com") };
  const name = resolveStatusMemberName(status);
  assert.equal(name, "a@x.com"); assert.ok(!name.includes("已刪除"));
  const noEmail = resolveStatusMemberName({ profile: { id: "u1", display_name: "", email: null }, historyLabel: label("u1") });
  assert.equal(noEmail, "u1");
}
function testDeletedLabelIsMarked() {
  assert.equal(resolveStatusMemberName({ profile: undefined, historyLabel: label("Bob", "2026-10-01T00:00:00Z") }), "Bob（已刪除）");
}
function testLiveLabelWithoutProfileIsNotMarkedDeleted() {
  assert.equal(resolveStatusMemberName({ profile: undefined, historyLabel: label("Cid", null) }), "Cid");
}
function testUnknown() { assert.equal(resolveStatusMemberName({ profile: undefined, historyLabel: undefined }), "Unknown"); }

const tests = [testNameFallbackOrder, testExistingProfileWithEmptyNameIsNotMarkedDeleted, testDeletedLabelIsMarked, testLiveLabelWithoutProfileIsNotMarkedDeleted, testUnknown];
let passed = 0, failed = 0;
for (const test of tests) {
  try { test(); passed++; console.log(`PASS ${test.name}`); }
  catch (error) { failed++; console.log(`FAIL ${test.name}: ${String(error.message).split("\n")[0]}`); }
}
console.log(`\n${passed}/${tests.length} memberLabel tests passed`);
process.exit(failed ? 1 : 0);
