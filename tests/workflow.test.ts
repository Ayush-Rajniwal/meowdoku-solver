import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solveAndAdvance } from "../src/automation/solve-and-advance.ts";
import type {
  NavigationReader,
  NavigationAction,
} from "../src/navigation/reader.ts";

const board = readFileSync(
  new URL("./fixtures/levels/level-077/input.png", import.meta.url),
);
function paths(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "puzzle-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    levelsRoot: join(root, "levels"),
    runtimeRoot: join(root, "runtime"),
  };
}
const identify = async () => ({ kind: "numbered" as const, number: 77 });
const action: NavigationAction = {
  kind: "leaderboard",
  key: "leader",
  label: "Tap to Continue",
  x: 720,
  y: 2783,
};
function reader(read: NavigationReader["read"]): NavigationReader {
  return { read, async close() {} };
}

test("workflow advances, solves a real saved board, and advances again with level-scoped artifacts", async (t) => {
  const p = paths(t);
  let frame = "leader",
    catTaps = 0,
    menuTaps = 0;
  const result = await solveAndAdvance({
    ...p,
    identify,
    device: {
      screenshot() {
        return frame === "board" || frame === "next-board"
          ? board
          : Buffer.from(frame);
      },
      async wait() {},
      async tap() {
        if (frame === "board") {
          if (++catTaps === 16) frame = "completed";
        } else {
          menuTaps++;
          frame =
            frame === "leader"
              ? "board"
              : frame === "completed"
                ? "next"
                : "next-board";
        }
      },
    },
    navigationReader: reader(async (png) => {
      if (png.equals(board))
        return { reason: "No supported completion overlay" };
      const key = png.toString();
      return {
        reason: "Recognized",
        action:
          key === "next"
            ? { ...action, kind: "next-level", key, label: "Level 78", y: 2454 }
            : { ...action, key },
      };
    }),
  });
  assert.equal(result.state, "played");
  assert.equal(catTaps, 16);
  assert.equal(menuTaps, 3);
  assert.equal(frame, "next-board");
  assert.ok(existsSync(join(result.directory!, "final.png")));
  assert.equal(
    JSON.parse(readFileSync(join(result.directory!, "execution.json"), "utf8"))
      .placedCats,
    8,
  );
  assert.equal(
    readFileSync(join(result.directory!, "advancement/actions.jsonl"), "utf8")
      .trim()
      .split("\n").length,
    2,
  );
});

test("workflow leaves a previously tapped continuation alone and never starts solving", async (t) => {
  const p = paths(t);
  mkdirSync(p.runtimeRoot, { recursive: true });
  writeFileSync(
    join(p.runtimeRoot, "navigation-state.json"),
    JSON.stringify({ ...action, time: new Date().toISOString() }),
  );
  const result = await solveAndAdvance({
    ...p,
    identify: async () =>
      assert.fail("Must not identify a puzzle behind a blocked continuation"),
    device: {
      screenshot: () => board,
      async wait() {},
      async tap() {
        assert.fail("Must not replay input");
      },
    },
    navigationReader: reader(async () => ({ action, reason: "Recognized" })),
  });
  assert.equal(result.state, "blocked");
  assert.equal(existsSync(p.levelsRoot), false);
});

test("workflow dry run previews a completion control without tapping or creating a level", async (t) => {
  const p = paths(t);
  const result = await solveAndAdvance({
    ...p,
    identify,
    dryRun: true,
    device: {
      screenshot: () => board,
      async wait() {},
      async tap() {
        assert.fail("Dry run must not tap");
      },
    },
    navigationReader: reader(async () => ({ action, reason: "Recognized" })),
  });
  assert.equal(result.state, "ready");
  assert.match(result.message, /Would tap Tap to Continue/);
  assert.equal(existsSync(p.levelsRoot), false);
});

test("workflow without navigation preserves manual-advance solving", async (t) => {
  let taps = 0;
  const result = await solveAndAdvance({
    ...paths(t),
    identify,
    device: {
      screenshot: () => board,
      async wait() {},
      async tap() {
        taps++;
      },
    },
  });
  assert.equal(result.state, "played");
  assert.equal(taps, 16);
  assert.equal(existsSync(join(result.directory!, "advancement")), false);
});
