import assert from "node:assert/strict";
import { formatDisplayName, formatMemberName, DELETED_SUFFIX } from "./displayName.ts";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

const CASES = [
  ["ian.hong", "Ian Hong"],
  ["Lucas.ZG", "Lucas ZG"],
  ["Office", "Office"],
  ["test_user.one", "Test User One"],
  [".ian..hong.", "Ian Hong"],
  ["ian", "Ian"],
  ["Ian Hong", "Ian Hong"],
  ["홍.길동", "홍 길동"],
  ["ian.hong@chromaate.co.kr", "ian.hong@chromaate.co.kr"],
  [UUID, UUID],
  [UUID.toUpperCase(), UUID.toUpperCase()],
  ["", ""],
  [null, ""],
  [undefined, ""],
];

function testExamples() {
  for (const [input, expected] of CASES) {
    assert.equal(formatDisplayName(input), expected, `formatDisplayName(${JSON.stringify(input)})`);
  }
}

function testIdempotent() {
  for (const [input] of CASES) {
    const once = formatDisplayName(input);
    assert.equal(formatDisplayName(once), once, `idempotent for ${JSON.stringify(input)}`);
  }
}

function testOnlyFirstCharacterChanges() {
  assert.equal(formatDisplayName("mcDonald.o'neil"), "McDonald O'neil");
  assert.equal(formatDisplayName("anne-marie.smith"), "Anne-marie Smith");
  assert.equal(formatDisplayName("ian hong"), "Ian hong");
  assert.equal(formatDisplayName("a_b"), "A B");
}

function testUnicodeFirstCharacterIsCodePoint() {
  // Astral code point (surrogate pair) with an uppercase mapping: must not be split in half.
  assert.equal(formatDisplayName("\u{10428}x.y"), "\u{10400}x Y");
  assert.equal(formatDisplayName("\u{1F600}.smile"), "\u{1F600} Smile");
  assert.equal(formatDisplayName("길동"), "길동");
}

function testNonStringInputDoesNotThrow() {
  assert.equal(formatDisplayName(42), "");
  assert.equal(formatDisplayName({}), "");
}

function testDeletedSuffixIsAppliedAfterFormatting() {
  assert.equal(DELETED_SUFFIX, "（已刪除）");
  assert.equal(formatMemberName("ian.hong（已刪除）"), "Ian Hong（已刪除）");
  assert.equal(formatMemberName("ian.（已刪除）"), "Ian（已刪除）");
  assert.equal(formatMemberName("Ian Hong（已刪除）"), "Ian Hong（已刪除）");
  assert.equal(formatMemberName("ian.hong"), "Ian Hong");
  assert.equal(formatMemberName("a@x.com（已刪除）"), "a@x.com（已刪除）");
  assert.equal(formatMemberName(null), "");
}

testExamples();
testIdempotent();
testOnlyFirstCharacterChanges();
testUnicodeFirstCharacterIsCodePoint();
testNonStringInputDoesNotThrow();
testDeletedSuffixIsAppliedAfterFormatting();
console.log("displayName tests passed");
