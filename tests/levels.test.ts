import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import { reserveLevelFolder } from "../src/levels/level-folder.ts";
import { prepareLevel } from "../src/levels/level-artifacts.ts";
import { runLevel, loadLevelPlan } from "../src/levels/level-runner.ts";
import { readLevelPlan, sha256 } from "../src/levels/level-plan.ts";
import type { LevelPlan } from "../src/levels/level-plan.ts";

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "android-puzzle-level-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function samplePlan(): LevelPlan {
  return {
    version: 1,
    inputSha256: sha256(Buffer.from("test input bytes")),
    image: { width: 500, height: 500 },
    boardSize: 4,
    existingCats: [{ row: 0, col: 1 }],
    taps: [
      { row: 1, col: 3, x: 250, y: 260 },
      { row: 2, col: 0, x: 100, y: 320 },
      { row: 3, col: 2, x: 200, y: 380 },
    ],
  };
}
function savedLevel(t: TestContext): string {
  const directory = temporary(t);
  writeFileSync(join(directory, "input.png"), "test input bytes");
  writeFileSync(
    join(directory, "output.json"),
    JSON.stringify(samplePlan(), null, 2) + "\n",
  );
  return directory;
}

test("numbered levels have consistent names and existing folders are preserved", (t) => {
  const root = temporary(t);
  const folder = reserveLevelFolder(root, "level-77");
  assert.equal(folder, join(root, "level-077"));
  writeFileSync(join(folder, "input.png"), "keep me");
  assert.throws(() => reserveLevelFolder(root, "level-077"), /EEXIST/);
  assert.equal(readFileSync(join(folder, "input.png"), "utf8"), "keep me");
});
test("golden fish IDs increment beyond the highest existing ID without overwriting", (t) => {
  const root = temporary(t);
  mkdirSync(join(root, "golden-fish-001"));
  mkdirSync(join(root, "golden-fish-003"));
  mkdirSync(join(root, "level-077"));
  assert.equal(
    reserveLevelFolder(root, "golden-fish"),
    join(root, "golden-fish-004"),
  );
  assert.equal(
    reserveLevelFolder(root, "golden-fish"),
    join(root, "golden-fish-005"),
  );
});
test("folder names reject path traversal", (t) => {
  const root = temporary(t);
  for (const name of [
    "../other",
    "/tmp/other",
    "two words",
    "../level-77",
    "",
  ]) {
    assert.throws(() => reserveLevelFolder(root, name), /level name/);
  }
});
test("prepare places input-derived artifacts together in a single level folder", (t) => {
  const directory = temporary(t);
  copyFileSync(
    new URL("./fixtures/levels/golden-fish-001/input.png", import.meta.url),
    join(directory, "input.png"),
  );
  const plan = prepareLevel(directory);
  assert.equal(plan.boardSize, 10);
  assert.equal(plan.taps.length, 10);
  assert.deepEqual(
    readLevelPlan(
      JSON.parse(readFileSync(join(directory, "output.json"), "utf8")),
    ),
    plan,
  );
  assert.deepEqual(readdirSync(directory).sort(), [
    "analysis",
    "input.png",
    "output.json",
    "preview.png",
  ]);
  assert.deepEqual(readdirSync(join(directory, "analysis")).sort(), [
    "diagnostics.json",
    "geometry.json",
    "puzzle.json",
    "solution.json",
  ]);
  assert.equal(existsSync(join(directory, "final.png")), false);
});
test("prepare does not replace artifacts with a prior execution record", (t) => {
  const directory = temporary(t);
  writeFileSync(join(directory, "execution.json"), "{}");
  assert.throws(() => prepareLevel(directory), /execution record/);
});
test("stored tap plans reject invalid positions, out-of-bounds pixels, and missing cats", () => {
  assert.deepEqual(readLevelPlan(samplePlan()), samplePlan());
  const base = samplePlan();
  for (const invalid of [
    { ...base, version: 2 },
    { ...base, inputSha256: "nope" },
    { ...base, image: { width: 0, height: 500 } },
    { ...base, taps: base.taps.slice(1) },
    { ...base, taps: [{ ...base.taps[0], x: 500 }, ...base.taps.slice(1)] },
    { ...base, taps: [{ ...base.taps[0], y: NaN }, ...base.taps.slice(1)] },
    { ...base, taps: [{ ...base.taps[0], row: -1 }, ...base.taps.slice(1)] },
    { ...base, taps: [{ ...base.taps[0], col: 1 }, ...base.taps.slice(1)] },
    {
      ...base,
      taps: [base.taps[0], { ...base.taps[1], x: 250, y: 260 }, base.taps[2]],
    },
  ])
    assert.throws(() => readLevelPlan(invalid));
});
test("changing the input invalidates its previously generated output", (t) => {
  const directory = savedLevel(t);
  assert.equal(loadLevelPlan(directory).plan.taps.length, 3);
  writeFileSync(join(directory, "input.png"), "different screenshot");
  assert.throws(() => loadLevelPlan(directory), /input.png has changed/);
});
test("runner consumes saved coordinates, double-taps them, and captures final.png last", async (t) => {
  const directory = savedLevel(t);
  const events: string[] = [];
  const screenshot = Buffer.from("final screenshot bytes");
  const record = await runLevel(directory, {
    async tap(x, y) {
      events.push("tap " + x + "," + y);
    },
    async wait(ms) {
      assert.equal(ms, 700);
      events.push("wait");
    },
    screenshot() {
      events.push("screenshot");
      return screenshot;
    },
  });
  assert.deepEqual(events, [
    "tap 250,260",
    "tap 250,260",
    "wait",
    "tap 100,320",
    "tap 100,320",
    "wait",
    "tap 200,380",
    "tap 200,380",
    "wait",
    "screenshot",
  ]);
  assert.equal(record.state, "taps-complete");
  assert.equal(record.placedCats, 3);
  assert.deepEqual(readFileSync(join(directory, "final.png")), screenshot);
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, "execution.json"), "utf8")),
    record,
  );
});
test("completed levels are not replayed or recaptured", async (t) => {
  const directory = savedLevel(t);
  await runLevel(directory, {
    async tap() {},
    async wait() {},
    screenshot() {
      return Buffer.from("first");
    },
  });
  const record = await runLevel(directory, {
    async tap() {
      assert.fail("Must not replay");
    },
    async wait() {
      assert.fail("Must not wait");
    },
    screenshot() {
      assert.fail("Must not overwrite final screenshot");
    },
  });
  assert.equal(record.state, "taps-complete");
  assert.equal(readFileSync(join(directory, "final.png"), "utf8"), "first");
});
test("tap failure stops immediately, saves a diagnostic screenshot, and blocks blind retry", async (t) => {
  const directory = savedLevel(t);
  let taps = 0;
  const device = {
    async tap() {
      if (++taps === 2) throw new Error("Disconnected during double-tap");
    },
    async wait() {
      assert.fail("No placement completed");
    },
    screenshot() {
      return Buffer.from("interrupted screen");
    },
  };
  await assert.rejects(
    runLevel(directory, device),
    /Disconnected during double-tap/,
  );
  assert.equal(taps, 2);
  const record = JSON.parse(
    readFileSync(join(directory, "execution.json"), "utf8"),
  );
  assert.equal(record.state, "failed");
  assert.equal(record.placedCats, 0);
  assert.equal(
    readFileSync(join(directory, "final.png"), "utf8"),
    "interrupted screen",
  );
  await assert.rejects(
    runLevel(directory, device),
    /previous execution exists/,
  );
  assert.equal(taps, 2);
});
test("screenshot failure is recorded instead of reporting a fully completed run", async (t) => {
  const directory = savedLevel(t);
  await assert.rejects(
    runLevel(directory, {
      async tap() {},
      async wait() {},
      screenshot() {
        throw new Error("Screenshot unavailable");
      },
    }),
    /Screenshot unavailable/,
  );
  const record = JSON.parse(
    readFileSync(join(directory, "execution.json"), "utf8"),
  );
  assert.equal(record.state, "failed");
  assert.equal(record.placedCats, 3);
  assert.equal(record.screenshotError, "Screenshot unavailable");
});
test("two runners cannot execute the same level concurrently", async (t) => {
  const directory = savedLevel(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const device = {
    async tap() {
      if (first) {
        first = false;
        await gate;
      }
    },
    async wait() {},
    screenshot() {
      return Buffer.from("done");
    },
  };
  const running = runLevel(directory, device);
  try {
    await assert.rejects(
      runLevel(directory, device),
      /previous execution exists/,
    );
  } finally {
    release();
  }
  assert.equal((await running).state, "taps-complete");
});
