import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  planCleanup,
  executeCleanup,
  cleanupOnQuit,
} from "../src/maintenance/cleanup.ts";
import { acquireLoopLock } from "../src/automation/loop-lock.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "puzzle-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime");
  const write = (name: string, ageDays = 10) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "data");
    const date = new Date(Date.now() - ageDays * 86_400_000);
    utimesSync(path, date, date);
    return path;
  };
  return { root, runtime, write };
}

test("cleanup preview selects only old runtime PNGs and changes nothing", (t) => {
  const { runtime, write } = fixture(t);
  const selected = [
    write("runtime/old.png"),
    write("runtime/navigation/old-before.png"),
  ];
  const retained = [
    write("runtime/latest-screen.png", 0),
    write("runtime/connection.json"),
    write("runtime/navigation-state.json"),
    write("runtime/navigation/actions.jsonl"),
    write("levels/level-077/input.png"),
    write("levels/level-077/execution.json"),
    write("levels/level-077/advancement/old-before.png"),
    write("tests/fixtures/navigation/test.png"),
    write("runtime/other/nested.png"),
  ];
  const plan = planCleanup(runtime);
  assert.deepEqual(plan.files.map((file) => file.path).sort(), selected.sort());
  assert.equal(plan.bytes, 8);
  for (const path of [...selected, ...retained])
    assert.equal(readFileSync(path, "utf8"), "data");
});

test("explicit cleanup removes diagnostic images while preserving replay guards and connection data", (t) => {
  const { runtime, write } = fixture(t);
  const screenshot = write("runtime/test.png", 0);
  const settings = write("runtime/connection.json");
  const guard = write("runtime/navigation-state.json");
  const result = executeCleanup(runtime, 0);
  assert.equal(result.files.length, 1);
  assert.equal(existsSync(screenshot), false);
  assert.equal(readFileSync(settings, "utf8"), "data");
  assert.equal(readFileSync(guard, "utf8"), "data");
  assert.equal(existsSync(join(runtime, "loop.lock")), false);
});

test("cleanup refuses deletion while the controller holds its lock", (t) => {
  const { runtime, write } = fixture(t);
  const path = write("runtime/old.png");
  const release = acquireLoopLock(runtime);
  try {
    assert.equal(planCleanup(runtime).files.length, 1);
    assert.throws(() => executeCleanup(runtime), /already running/);
    assert.ok(existsSync(path));
  } finally {
    release();
  }
});

test("cleanup never follows file or navigation-directory symlinks", (t) => {
  const { root, runtime, write } = fixture(t);
  const target = write("private/image.png");
  mkdirSync(runtime);
  symlinkSync(target, join(runtime, "link.png"));
  symlinkSync(join(root, "private"), join(runtime, "navigation"));
  assert.equal(executeCleanup(runtime, 0).files.length, 0);
  assert.equal(readFileSync(target, "utf8"), "data");
});

test("cleanup rejects a symlinked runtime root and invalid ages", (t) => {
  const { root, runtime, write } = fixture(t);
  write("private/image.png");
  symlinkSync(join(root, "private"), runtime);
  assert.throws(() => executeCleanup(runtime), /symlinked runtime/);
  assert.throws(() => planCleanup(runtime, -1), /nonnegative/);
  assert.throws(() => planCleanup(runtime, Infinity), /nonnegative/);
});

test("quitting removes fresh runtime images while holding the session lock until cleanup finishes", (t) => {
  const { runtime, write } = fixture(t);
  const paths = [
    write("runtime/latest-screen.png", 0),
    write("runtime/navigation/now-before.png", 0),
  ];
  const retained = [
    write("runtime/connection.json"),
    write("runtime/navigation-state.json"),
    write("runtime/navigation/actions.jsonl"),
    write("levels/level-099/final.png"),
  ];
  const release = acquireLoopLock(runtime);
  let released = false;
  const plan = cleanupOnQuit(
    runtime,
    () => {
      assert.ok(existsSync(join(runtime, "loop.lock")));
      for (const path of paths) assert.equal(existsSync(path), false);
      release();
      released = true;
    },
    (message) => assert.fail(message),
  );
  assert.equal(plan?.files.length, 2);
  assert.ok(released);
  for (const path of retained) assert.equal(readFileSync(path, "utf8"), "data");
  assert.equal(existsSync(join(runtime, "loop.lock")), false);
});

test("cleanup failure is reported and still releases the session", (t) => {
  const { root, runtime, write } = fixture(t);
  write("private/image.png");
  symlinkSync(join(root, "private"), runtime);
  const errors: string[] = [];
  let released = false;
  assert.equal(
    cleanupOnQuit(
      runtime,
      () => {
        released = true;
      },
      (message) => errors.push(message),
    ),
    undefined,
  );
  assert.equal(released, true);
  assert.match(errors[0]!, /cleanup failed.*symlinked/);
  assert.equal(readFileSync(join(root, "private/image.png"), "utf8"), "data");
});
