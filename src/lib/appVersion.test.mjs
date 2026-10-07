import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const pkg = JSON.parse(read("../../package.json"));
const lock = JSON.parse(read("../../package-lock.json"));

function testSingleSourceIsPackageJson() {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version, "package-lock top-level version must match package.json");
  assert.equal(lock.packages[""].version, pkg.version, "package-lock root package version must match package.json");
}

function testBadgeReadsInjectedVersionOnly() {
  const config = read("../../next.config.ts");
  assert.match(config, /NEXT_PUBLIC_APP_VERSION:\s*packageJson\.version/, "next.config must inject only packageJson.version");
  assert.ok(!/NEXT_PUBLIC_\w+:\s*packageJson\s*[,}\n]/.test(config), "the whole package.json must not be injected");
  const header = read("../components/Header.tsx");
  assert.match(header, /process\.env\.NEXT_PUBLIC_APP_VERSION/, "Header badge must read NEXT_PUBLIC_APP_VERSION");
  assert.ok(!/\b\d+\.\d+\.\d+\b/.test(header.replace(/\bv?\d+\.\d+\.\d+-/g, "")), "Header must not hard-code a version string");
  assert.ok(!/from\s+["'].*package\.json["']/.test(header), "Header must not import package.json");
}

testSingleSourceIsPackageJson();
testBadgeReadsInjectedVersionOnly();
console.log("appVersion tests passed (version " + pkg.version + ")");
