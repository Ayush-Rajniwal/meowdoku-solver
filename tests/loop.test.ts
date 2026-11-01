import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { cycle } from "../src/automation/loop-cycle.ts";
import { poll } from "../src/automation/polling-loop.ts";
import { acquireLoopLock } from "../src/automation/loop-lock.ts";
import { boardFingerprint } from "../src/solver/board-identity.ts";
import { createHeaderReader } from "../src/vision/level-header.ts";
import type { LevelHeader } from "../src/vision/level-header.ts";

const input9 = readFileSync(
  new URL("./fixtures/levels/level-077/input.png", import.meta.url),
);
const input10 = readFileSync(
  new URL("./fixtures/levels/golden-fish-001/input.png", import.meta.url),
);
const overlay = readFileSync(
  new URL("./fixtures/levels/level-077/final.png", import.meta.url),
);
function paths(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "puzzle-loop-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    levelsRoot: join(root, "levels"),
    runtimeRoot: join(root, "runtime"),
  };
}
function fake(png = input10) {
  let taps = 0,
    captures = 0;
  return {
    get taps() {
      return taps;
    },
    get captures() {
      return captures;
    },
    async tap() {
      taps++;
    },
    async wait() {},
    screenshot() {
      captures++;
      return png;
    },
  };
}
test("board identity ignores marks and color ID labels", () => {
  const a = {
    regions: [
      ["red", "red"],
      ["blue", "blue"],
    ],
    fixedCats: [{ row: 0, col: 0 }],
  };
  const b = {
    regions: [
      [5, 5],
      [8, 8],
    ],
    fixedCats: [],
  };
  assert.equal(boardFingerprint(a), boardFingerprint(b));
  assert.notEqual(
    boardFingerprint(a),
    boardFingerprint({
      regions: [
        [5, 8],
        [5, 8],
      ],
    }),
  );
});
test("local OCR recognizes numbered, shifted Hard-level, and unnamed golden-fish headers", async () => {
  const reader = await createHeaderReader();
  try {
    assert.deepEqual(await reader.read(input9), {
      kind: "numbered",
      number: 77,
    });
    assert.deepEqual(await reader.read(input10), { kind: "golden-fish" });
    const hard = readFileSync(
      new URL("./fixtures/vision/crosses-level-140.png", import.meta.url),
    );
    assert.deepEqual(await reader.read(hard), {
      kind: "numbered",
      number: 140,
    });
  } finally {
    await reader.close();
  }
});
test("one cycle captures, prepares, double-taps all remaining cats, and saves final output", async (t) => {
  const p = paths(t),
    device = fake(input9);
  const result = await cycle({
    ...p,
    device,
    identify: async () => ({ kind: "numbered", number: 77 }),
  });
  assert.equal(result.state, "played");
  assert.equal(result.directory, join(p.levelsRoot, "level-077"));
  assert.equal(device.taps, 16);
  assert.equal(device.captures, 3);
  for (const file of [
    "input.png",
    "output.json",
    "preview.png",
    "final.png",
    "execution.json",
  ]) {
    assert.ok(existsSync(join(result.directory!, file)), file);
  }
  const record = JSON.parse(
    readFileSync(join(result.directory!, "execution.json"), "utf8"),
  );
  assert.equal(record.state, "taps-complete");
  assert.equal(record.placedCats, 8);
});
test("an unchanged already-played board is skipped, including after restarting the controller", async (t) => {
  const p = paths(t),
    first = fake(input10);
  const identify = async (): Promise<LevelHeader> => ({ kind: "golden-fish" });
  assert.equal(
    (await cycle({ ...p, device: first, identify })).state,
    "played",
  );
  const restarted = fake(input10);
  const result = await cycle({ ...p, device: restarted, identify });
  assert.equal(result.state, "waiting");
  assert.match(result.message, /Already played/);
  assert.equal(restarted.taps, 0);
  assert.deepEqual(readdirSync(p.levelsRoot), ["golden-fish-001"]);
});
test("advancing to a different puzzle creates the next golden-fish folder automatically", async (t) => {
  const p = paths(t),
    identify = async (): Promise<LevelHeader> => ({ kind: "golden-fish" });
  const first = await cycle({ ...p, device: fake(input9), identify });
  const second = await cycle({ ...p, device: fake(input10), identify });
  assert.equal(first.state, "played");
  assert.equal(second.state, "played");
  assert.equal(second.directory, join(p.levelsRoot, "golden-fish-002"));
});
test("dry run performs no taps or level creation", async (t) => {
  const p = paths(t),
    device = fake();
  const result = await cycle({
    ...p,
    device,
    dryRun: true,
    identify: async () => ({ kind: "golden-fish" }),
  });
  assert.equal(result.state, "ready");
  assert.equal(device.taps, 0);
  assert.equal(existsSync(p.levelsRoot), false);
});
test("win overlays and changing grids wait without sending taps", async (t) => {
  const p = paths(t),
    device = fake(overlay);
  assert.equal(
    (
      await cycle({
        ...p,
        device,
        identify: async () => {
          assert.fail("Must not OCR overlay");
        },
      })
    ).state,
    "waiting",
  );
  assert.equal(device.taps, 0);
  let captures = 0;
  const changing = {
    ...fake(),
    screenshot() {
      return captures++ === 0 ? input9 : input10;
    },
  };
  const result = await cycle({
    ...p,
    device: changing,
    identify: async () => {
      assert.fail("Board must settle first");
    },
  });
  assert.equal(result.state, "waiting");
  assert.match(result.message, /changing/);
  assert.equal(changing.taps, 0);
});
test("an unreadable header waits without allocating a level", async (t) => {
  const p = paths(t),
    device = fake();
  const result = await cycle({
    ...p,
    device,
    identify: async () => {
      throw new Error("Unknown header");
    },
  });
  assert.equal(result.state, "waiting");
  assert.equal(device.taps, 0);
  assert.equal(existsSync(p.levelsRoot), false);
});
test("a failed double-tap is recorded and not retried on the next cycle", async (t) => {
  const p = paths(t);
  let taps = 0;
  const device = {
    ...fake(),
    async tap() {
      if (++taps === 2) throw new Error("Device disconnected");
    },
  };
  const identify = async (): Promise<LevelHeader> => ({ kind: "golden-fish" });
  assert.equal((await cycle({ ...p, device, identify })).state, "error");
  const retry = fake();
  assert.equal(
    (await cycle({ ...p, device: retry, identify })).state,
    "blocked",
  );
  assert.equal(retry.taps, 0);
});
test("cancellation during the settling wait prevents all taps", async (t) => {
  const p = paths(t),
    controller = new AbortController(),
    device = fake();
  const result = await cycle({
    ...p,
    signal: controller.signal,
    device: {
      ...device,
      async wait() {
        controller.abort();
      },
    },
    identify: async () => {
      assert.fail("Must stop before OCR");
    },
  });
  assert.equal(result.state, "waiting");
  assert.equal(device.taps, 0);
});
test("a disconnected phone produces an error and the next check can still run", async (t) => {
  const p = paths(t),
    device = fake();
  const identify = async (): Promise<LevelHeader> => ({ kind: "golden-fish" });
  const failed = await cycle({
    ...p,
    device: {
      ...device,
      screenshot() {
        throw new Error("No device");
      },
    },
    identify,
  });
  assert.equal(failed.state, "error");
  const next = await cycle({ ...p, device, dryRun: true, identify });
  assert.equal(next.state, "ready");
  assert.equal(device.taps, 0);
});
test("poll runs immediately and keeps a 60-second cadence without overlap", async () => {
  const controller = new AbortController();
  let now = 0,
    calls = 0,
    active = false;
  const waits: number[] = [];
  await poll({
    intervalMs: 60_000,
    signal: controller.signal,
    now: () => now,
    async cycle() {
      assert.equal(active, false);
      active = true;
      await Promise.resolve();
      calls++;
      now += 20_000;
      active = false;
    },
    async wait(ms) {
      waits.push(ms);
      now += ms;
      if (calls === 3) controller.abort();
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [40_000, 40_000, 40_000]);
});
test("a slow cycle finishes before another one starts", async () => {
  const controller = new AbortController();
  let now = 0,
    calls = 0;
  await poll({
    intervalMs: 60_000,
    signal: controller.signal,
    now: () => now,
    async cycle() {
      now += 90_000;
      calls++;
    },
    async wait(ms) {
      assert.equal(ms, 0);
      controller.abort();
    },
  });
  assert.equal(calls, 1);
});
test("once mode performs one cycle and does not schedule another", async () => {
  let calls = 0;
  await poll({
    intervalMs: 60_000,
    signal: new AbortController().signal,
    once: true,
    async cycle() {
      calls++;
    },
    async wait() {
      assert.fail("Must not wait");
    },
  });
  assert.equal(calls, 1);
});
test("process lock blocks a second loop and is released on clean shutdown", (t) => {
  const { runtimeRoot } = paths(t);
  const release = acquireLoopLock(runtimeRoot);
  try {
    assert.throws(() => acquireLoopLock(runtimeRoot), /already running/);
  } finally {
    release();
  }
  const again = acquireLoopLock(runtimeRoot);
  again();
  assert.equal(existsSync(join(runtimeRoot, "loop.lock")), false);
});
