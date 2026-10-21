import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [
  "TEST_GO_DIRECTORY",
  "EMBEDDED_PG_TOOLS",
  "REDIS_TEST_BIN",
  "ANDROID_GRADLE_WRAPPER",
  "JAVA_HOME",
  "ANDROID_HOME",
])
  if (!process.env[name])
    throw new Error(`Set ${name} before running the complete verification`);
const dist = path.resolve(root, "dist");
if (path.dirname(dist) !== root) throw new Error("Unsafe build output path");
fs.rmSync(dist, { recursive: true, force: true });
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32" && /\.(cmd|bat)$/.test(command),
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["ci", "--ignore-scripts", "--legacy-peer-deps"]);
run(npm, ["run", "build"]);
run(npm, ["test"]);
run(npm, ["pack", "--dry-run", "--ignore-scripts"]);
run(process.env.ANDROID_GRADLE_WRAPPER, [
  "-p",
  "tools/android-smoke",
  ":sdk:clean",
  ":sdk:assembleRelease",
  ":sdk:lintRelease",
  "--console=plain",
]);
run(
  process.execPath,
  [
    "tools/run-isolated-tests.mjs",
    ...(process.env.TEST_GO_ALL === "1"
      ? ["./..."]
      : [
          "-run",
          "TestReactNativeEndToEnd|TestEventIdempotency",
          "./integration",
        ]),
  ],
  process.env.TEST_GO_DIRECTORY,
  { ...process.env, TEST_REACT_NATIVE_SDK_DIRECTORY: root },
);
console.log(
  "PASS: clean install, TypeScript, unit tests, package, Android build/lint and fresh Go/PG/Redis integration.",
);
