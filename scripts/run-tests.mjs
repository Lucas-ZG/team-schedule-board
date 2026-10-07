// scripts/run-tests.mjs
// Thin, dependency-free runner for the existing Node test files. Runs each
// suite to completion even if an earlier one fails, so `npm test` always
// exercises both instead of stopping at the first failure.

import { spawnSync } from "node:child_process";

const suites = [
  "src/lib/activityLogSummary.test.mjs",
  "supabase/functions/create-user/handler.test.mjs",
  "supabase/functions/delete-user/handler.test.mjs",
  "src/lib/deleteUserApi.test.mjs",
  "src/lib/memberLabel.test.mjs",
  "src/lib/displayName.test.mjs",
  "src/lib/appVersion.test.mjs",
];

let failed = false;

for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite], { stdio: "inherit" });
  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
