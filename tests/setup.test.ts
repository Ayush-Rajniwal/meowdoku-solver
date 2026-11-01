import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
function fixture(
  t: TestContext,
  options: { missingNode?: boolean; badChecksum?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "android setup "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ["setup.sh", "run.sh"])
    copyFileSync(join(project, file), join(root, file));
  const bin = join(root, "bin"),
    downloads = join(root, "downloads"),
    stage = join(root, "archives");
  for (const dir of [bin, downloads, stage])
    mkdirSync(dir, { recursive: true });
  const script = (path: string, text: string) => {
    writeFileSync(path, "#!/bin/bash\nset -e\n" + text + "\n");
    chmodSync(path, 0o755);
  };
  for (const name of [
    "dirname",
    "sed",
    "mkdir",
    "mktemp",
    "rm",
    "mv",
    "tar",
    "gzip",
    "awk",
    "shasum",
    "unzip",
  ]) {
    const found = spawnSync("/bin/sh", ["-c", "command -v " + name], {
      encoding: "utf8",
    }).stdout.trim();
    symlinkSync(found, join(bin, name));
  }
  script(
    join(bin, "uname"),
    'if [[ "$1" == -s ]]; then echo Darwin; else echo arm64; fi',
  );
  const calls = join(root, "npm-calls.txt");
  const npmScript = `if [[ "\${1:-}" == --version ]]; then echo 11.0.0; else printf '%s\\n' "$*" >> ${shellQuote(calls)}; fi`;
  if (options.missingNode)
    script(
      join(bin, "node"),
      'if [[ "\${1:-}" == -e ]]; then exit 1; else echo v20.0.0; fi',
    );
  else symlinkSync(process.execPath, join(bin, "node"));
  script(join(bin, "npm"), npmScript);
  const archive = "node-v24.99.0-darwin-arm64.tar.gz";
  const nodeDir = join(stage, archive.replace(".tar.gz", ""));
  mkdirSync(join(nodeDir, "bin"), { recursive: true });
  script(
    join(nodeDir, "bin/node"),
    "exec " + shellQuote(process.execPath) + ' "$@"',
  );
  script(join(nodeDir, "bin/npm"), npmScript);
  assert.equal(
    spawnSync("/usr/bin/tar", [
      "-czf",
      join(downloads, archive),
      "-C",
      stage,
      archive.replace(".tar.gz", ""),
    ]).status,
    0,
  );
  const hash = createHash("sha256")
    .update(readFileSync(join(downloads, archive)))
    .digest("hex");
  writeFileSync(
    join(downloads, "SHASUMS256.txt"),
    (options.badChecksum ? "0".repeat(64) : hash) + "  " + archive + "\n",
  );
  const platform = join(stage, "platform-tools");
  mkdirSync(platform);
  script(join(platform, "adb"), 'echo "Android Debug Bridge version 1.0.41"');
  assert.equal(
    spawnSync(
      "/usr/bin/zip",
      [
        "-qr",
        join(downloads, "platform-tools-latest-darwin.zip"),
        "platform-tools",
      ],
      { cwd: stage },
    ).status,
    0,
  );
  script(
    join(bin, "curl"),
    `url=''\nout=''\nwhile [[ $# -gt 0 ]]; do case "$1" in --output) out="$2"; shift 2;; https://*) url="$1"; shift;; *) shift;; esac; done\n/bin/cp ${shellQuote(downloads)}/"\${url##*/}" "$out"`,
  );
  const env = {
    ...process.env,
    PATH: bin,
    ADB_PATH: "",
    ANDROID_HOME: "",
    ANDROID_SDK_ROOT: "",
  };
  const run = (...args: string[]) =>
    spawnSync("/bin/bash", [join(root, "setup.sh"), ...args], {
      cwd: tmpdir(),
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
  return { root, bin, calls, run, env };
}

test("setup downloads and verifies missing tools locally, installs locked packages, and can be rerun", (t) => {
  const f = fixture(t, { missingNode: true });
  const first = f.run();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(existsSync(join(f.root, ".tools/node/bin/node")));
  assert.ok(existsSync(join(f.root, ".tools/platform-tools/adb")));
  assert.match(
    readFileSync(f.calls, "utf8"),
    /ci --include=dev --no-audit --no-fund/,
  );
  assert.match(readFileSync(f.calls, "utf8"), /run typecheck/);
  // Installed tools are reused even if downloading becomes unavailable.
  rmSync(join(f.bin, "curl"));
  const second = f.run();
  assert.equal(second.status, 0, second.stdout + second.stderr);
  for (const name of ["tsx", "ink"]) {
    mkdirSync(join(f.root, "node_modules", name), { recursive: true });
    writeFileSync(join(f.root, "node_modules", name, "package.json"), "{}");
  }
  assert.equal(f.run("--check").status, 0);
  const launched = spawnSync("/bin/bash", [join(f.root, "run.sh"), "--pair"], {
    cwd: tmpdir(),
    env: f.env,
    encoding: "utf8",
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.match(readFileSync(f.calls, "utf8"), /start -- --pair/);
});
test("setup rejects a corrupt Node download before installing or invoking npm ci", (t) => {
  const f = fixture(t, { missingNode: true, badChecksum: true });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum mismatch/);
  assert.equal(existsSync(join(f.root, ".tools/node")), false);
  assert.equal(existsSync(f.calls), false);
});
test("read-only preflight does not download or install anything", (t) => {
  const f = fixture(t, { missingNode: true });
  const result = f.run("--check");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Node 24\+ and npm: missing/);
  assert.equal(existsSync(join(f.root, ".tools")), false);
  assert.equal(existsSync(f.calls), false);
});
test("setup refuses to replace dependencies while a controller process is alive", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, "runtime"));
  writeFileSync(
    join(f.root, "runtime/loop.lock"),
    JSON.stringify({ pid: process.pid }),
  );
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stop the running controller/);
  assert.equal(existsSync(join(f.root, ".tools")), false);
  assert.equal(existsSync(f.calls), false);
});
