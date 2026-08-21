// supabase/functions/create-user/handler.test.mjs
// Node-based unit test for handler.ts, run without Deno or a real Supabase
// deployment by injecting mock clients. Run with:
//   node --experimental-strip-types supabase/functions/create-user/handler.test.mjs
// (or plain `node` on a Node version where type stripping is on by default).
//
// This exists because this environment has no Supabase CLI / Deno runtime,
// so the Edge Function can't be deployed or exercised end-to-end here. It
// verifies the exact same handler.ts that index.ts calls in production --
// only the Supabase clients are mocked, the control flow under test is real.

import assert from "node:assert/strict";
import { handleCreateUser } from "./handler.ts";

function makeCallerClient({ isAdmin }) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "caller-1" } }, error: null }),
      admin: {
        createUser: async () => {
          throw new Error("callerClient should never call admin.createUser");
        },
        deleteUser: async () => {
          throw new Error("callerClient should never call admin.deleteUser");
        },
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { role: isAdmin ? "admin" : "user" },
            error: null,
          }),
        }),
      }),
      upsert: () => {
        throw new Error("callerClient should never call upsert");
      },
    }),
  };
}

// profileWriteSucceeds simulates whether the post-creation profiles upsert
// (which no longer depends on the on_auth_user_created DB trigger having
// already inserted a row -- see handler.ts comment, production proved that
// trigger isn't reliably active) returns a written row or not.
function makeAdminClient({ profileWriteSucceeds, deleteSucceeds }) {
  const calls = { createUser: 0, upsertProfile: 0, deleteUser: 0, deletedId: null };
  return {
    calls,
    auth: {
      getUser: async () => {
        throw new Error("adminClient should never call auth.getUser");
      },
      admin: {
        createUser: async (args) => {
          calls.createUser += 1;
          return {
            data: { user: { id: "new-user-1", email: args.email } },
            error: null,
          };
        },
        deleteUser: async (userId) => {
          calls.deleteUser += 1;
          calls.deletedId = userId;
          return { error: deleteSucceeds ? null : { message: "delete failed" } };
        },
      },
    },
    from: () => ({
      select: () => {
        throw new Error("adminClient should never call select in this test");
      },
      upsert: () => ({
        select: () => ({
          single: async () => {
            calls.upsertProfile += 1;
            return profileWriteSucceeds
              ? { data: { id: "new-user-1" }, error: null }
              : { data: null, error: null }; // simulates a failed/0-row upsert
          },
        }),
      }),
    }),
  };
}

async function testNonAdminRejected() {
  const caller = makeCallerClient({ isAdmin: false });
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });
  const res = await handleCreateUser(caller, admin, {
    email: "x@example.com",
    password: "abcdef",
    role: "user",
  });
  assert.equal(res.status, 403);
  assert.equal(admin.calls.createUser, 0, "must not create a user for a non-admin caller");
}

async function testSuccessDefaultRoleStillWritesProfile() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });
  const res = await handleCreateUser(caller, admin, {
    email: "new@example.com",
    password: "abcdef",
    role: "user",
  });
  assert.equal(res.status, 200);
  assert.equal(admin.calls.createUser, 1);
  assert.equal(
    admin.calls.upsertProfile,
    1,
    "the default 'user' role must still get its profile row written explicitly, not assumed from a DB trigger",
  );
}

async function testSuccessNonDefaultRole() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });
  const res = await handleCreateUser(caller, admin, {
    email: "new-admin@example.com",
    password: "abcdef",
    role: "admin",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, "admin");
  assert.equal(admin.calls.upsertProfile, 1);
  assert.equal(admin.calls.deleteUser, 0, "no rollback expected on success");
}

// This is the scenario found in real production testing (2026-08-21): the
// profiles upsert fails/returns 0 rows (there, because the DB trigger that
// was assumed to pre-create the row wasn't actually active). The Auth user
// that was already created must be deleted so the system doesn't end up
// with a stuck, profile-less account under an email that can no longer be
// retried.
async function testProfileWriteFailureTriggersRollback() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: false, deleteSucceeds: true });
  const res = await handleCreateUser(caller, admin, {
    email: "broken-role@example.com",
    password: "abcdef",
    role: "viewer",
  });
  assert.equal(res.status, 500);
  assert.equal(admin.calls.createUser, 1);
  assert.equal(admin.calls.upsertProfile, 1);
  assert.equal(admin.calls.deleteUser, 1, "must delete the orphaned auth user");
  assert.equal(admin.calls.deletedId, "new-user-1");
  assert.match(res.body.error, /rolled back/i);
  assert.equal(res.body.userId, undefined, "a clean rollback should not ask the caller to manually clean up an id");
}

// If even the compensating delete fails, the response must not look like
// a safe-to-retry failure -- it must surface the orphaned user id.
async function testProfileWriteFailureAndDeleteFailureSurfacesUserId() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: false, deleteSucceeds: false });
  const res = await handleCreateUser(caller, admin, {
    email: "double-fail@example.com",
    password: "abcdef",
    role: "admin",
  });
  assert.equal(res.status, 500);
  assert.equal(admin.calls.deleteUser, 1);
  assert.equal(res.body.userId, "new-user-1", "must surface the id for manual cleanup");
  assert.equal(res.body.requestedRole, "admin");
}

async function testValidationRejectsShortPassword() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });
  const res = await handleCreateUser(caller, admin, {
    email: "x@example.com",
    password: "abc",
    role: "user",
  });
  assert.equal(res.status, 400);
  assert.equal(admin.calls.createUser, 0);
}

// Regression test for the review finding: a syntactically valid JSON body
// that isn't a plain object (null, array, string, number) must not throw --
// it must be rejected with a clean 400, same as any other bad input.
async function testMalformedBodyShapesReturnClean400() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });

  for (const malformed of [null, [], "just a string", 42, true]) {
    const res = await handleCreateUser(caller, admin, malformed);
    assert.equal(
      res.status,
      400,
      `expected 400 for malformed body ${JSON.stringify(malformed)}, got ${res.status}`,
    );
    assert.ok(typeof res.body.error === "string" && res.body.error.length > 0);
  }
  assert.equal(admin.calls.createUser, 0, "malformed bodies must never reach account creation");
}

// The outer try/catch in handleCreateUser must turn an unexpected throw
// anywhere in the flow into a clean 500 JSON response, not an unhandled
// rejection that would crash the Edge Function and lose CORS headers.
async function testUnexpectedThrowIsCaughtAsClean500() {
  const throwingCaller = {
    auth: {
      getUser: async () => {
        throw new Error("simulated unexpected failure");
      },
      admin: {
        createUser: async () => {
          throw new Error("should not be reached");
        },
        deleteUser: async () => {
          throw new Error("should not be reached");
        },
      },
    },
    from: () => {
      throw new Error("should not be reached");
    },
  };
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });
  const res = await handleCreateUser(throwingCaller, admin, {
    email: "x@example.com",
    password: "abcdef",
    role: "user",
  });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /simulated unexpected failure/);
}

async function testBodyHasNoDisplayNameField() {
  const caller = makeCallerClient({ isAdmin: true });
  const admin = makeAdminClient({ profileWriteSucceeds: true, deleteSucceeds: true });
  const res = await handleCreateUser(caller, admin, {
    email: "new2@example.com",
    password: "abcdef",
    role: "user",
    // @ts-expect-error -- intentionally passing an extra field to confirm it's ignored
    display_name: "Should Be Ignored",
  });
  assert.equal(res.status, 200);
  assert.ok(!("display_name" in res.body), "response must not echo a display_name field");
}

const tests = [
  testNonAdminRejected,
  testSuccessDefaultRoleStillWritesProfile,
  testSuccessNonDefaultRole,
  testProfileWriteFailureTriggersRollback,
  testProfileWriteFailureAndDeleteFailureSurfacesUserId,
  testValidationRejectsShortPassword,
  testMalformedBodyShapesReturnClean400,
  testUnexpectedThrowIsCaughtAsClean500,
  testBodyHasNoDisplayNameField,
];

let passed = 0;
for (const test of tests) {
  await test();
  passed += 1;
  console.log(`PASS ${test.name}`);
}
console.log(`\n${passed}/${tests.length} tests passed`);
