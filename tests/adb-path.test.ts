import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveAdbPath } from "../src/android/adb-path.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "adb-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = {
    root,
    home: join(root, "person"),
    env: {} as NodeJS.ProcessEnv,
  };
  const binary = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "#!/bin/sh\nexit 0\n");
    chmodSync(path, 0o755);
    return path;
  };
  return { root, options, binary };
}
test("ADB_PATH overrides all automatic discovery", (t) => {
  const { options, binary, root } = fixture(t);
  binary(join(root, ".tools/platform-tools/adb"));
  assert.equal(
    resolveAdbPath({ ...options, env: { ADB_PATH: "/custom/adb" } }),
    "/custom/adb",
  );
});
test("project-local ADB wins over SDK and PATH, including paths with spaces", (t) => {
  const { options, binary, root } = fixture(t);
  const local = binary(join(root, ".tools/platform-tools/adb"));
  const sdk = join(root, "Android SDK");
  binary(join(sdk, "platform-tools/adb"));
  assert.equal(
    resolveAdbPath({ ...options, env: { ANDROID_HOME: sdk, PATH: "/bin" } }),
    local,
  );
});
test("SDK, PATH, and legacy extracted Downloads are discovered without a username", (t) => {
  const { options, binary, root } = fixture(t);
  const sdk = join(root, "sdk"),
    bin = join(root, "bin");
  const sdkAdb = binary(join(sdk, "platform-tools/adb"));
  const pathAdb = binary(join(bin, "adb"));
  assert.equal(
    resolveAdbPath({ ...options, env: { ANDROID_SDK_ROOT: sdk, PATH: bin } }),
    sdkAdb,
  );
  assert.equal(resolveAdbPath({ ...options, env: { PATH: bin } }), pathAdb);
  const legacy = binary(join(options.home, "Downloads/platform-tools/adb"));
  assert.equal(resolveAdbPath(options), legacy);
});
test("missing executables fall back to adb with a useful transport error", (t) => {
  const { options } = fixture(t);
  assert.equal(resolveAdbPath(options), "adb");
});
