import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { it, expect } from "vitest";
const require = createRequire(import.meta.url);
it("native autolinking configuration satisfies the real RN CLI schema", () => {
  const {
    dependencyConfig,
  } = require("@react-native-community/cli-config/build/schema");
  const config = require("../react-native.config.js");
  expect(dependencyConfig.validate(config).error).toBeUndefined();
  const android = config.dependency.platforms.android;
  const qualified = android.packageImportPath.match(/import ([\w.]+);/)[1];
  expect(
    existsSync(
      resolve(
        android.sourceDir,
        "src/main/java",
        qualified.replaceAll(".", "/") + ".java",
      ),
    ),
  ).toBe(true);
  expect(readFileSync("AppInstallAttribution.podspec", "utf8")).toContain(
    "s.source_files = 'ios/**/*.{h,m,mm}'",
  );
  expect(existsSync("ios/AppInstallAttribution.mm")).toBe(true);
});
