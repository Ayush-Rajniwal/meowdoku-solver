import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import type { TestContext } from "node:test";
import { createNavigationReader } from "../src/navigation/reader.ts";
import type {
  NavigationReader,
  NavigationAction,
} from "../src/navigation/reader.ts";
import { advanceScreens } from "../src/navigation/advance.ts";

const fixture = (name: string) =>
  readFileSync(new URL("./fixtures/navigation/" + name, import.meta.url));
test("real screenshots recognize continuation controls and reject unsupported screens", async (t) => {
  const reader = await createNavigationReader();
  try {
    for (const [file, kind, x, y] of [
      ["leaderboard-numbered.png", "leaderboard", 720, 2783],
      ["leaderboard-golden.png", "leaderboard", 720, 2783],
      ["milestone.png", "continue", 720, 2467],
      ["next-level.png", "next-level", 720, 2454],
      ["golden-fish-offer.png", "golden-fish", 720, 2398],
    ] as const) {
      await t.test(file, async () => {
        const result = await reader.read(fixture(file));
        assert.equal(result.action?.kind, kind);
        assert.ok(Math.abs(result.action!.x - x) < 12);
        assert.ok(Math.abs(result.action!.y - y) < 12);
      });
    }
    for (const file of [
      "active-board.png",
      "golden-intro.png",
      "milestone-animation.png",
      "touch-protection.png",
    ]) {
      await t.test("rejects " + file, async () =>
        assert.equal((await reader.read(fixture(file))).action, undefined),
      );
    }
    await t.test(
      "button with missing/animating text is not tapped",
      async () => {
        const image = PNG.sync.read(fixture("milestone.png"));
        for (let y = 2360; y < 2573; y++)
          for (let x = 220; x < 1220; x++) {
            const i = (y * image.width + x) * 4;
            if (
              image.data[i]! > 210 &&
              image.data[i + 1]! > 200 &&
              image.data[i + 2]! > 170
            ) {
              image.data[i] = 244;
              image.data[i + 1] = 146;
              image.data[i + 2] = 20;
            }
          }
        assert.equal(
          (await reader.read(PNG.sync.write(image))).action,
          undefined,
        );
      },
    );
    await t.test(
      "half-resolution image retains valid scaled coordinates",
      async () => {
        const source = PNG.sync.read(fixture("milestone.png"));
        const small = new PNG({
          width: source.width / 2,
          height: source.height / 2,
        });
        for (let y = 0; y < small.height; y++)
          for (let x = 0; x < small.width; x++) {
            const from = (y * 2 * source.width + x * 2) * 4,
              to = (y * small.width + x) * 4;
            source.data.copy(small.data, to, from, from + 4);
          }
        const result = await reader.read(PNG.sync.write(small));
        assert.equal(result.action?.kind, "continue");
        assert.ok(Math.abs(result.action!.x - 360) < 6);
        assert.ok(Math.abs(result.action!.y - 1233) < 6);
      },
    );
  } finally {
    await reader.close();
  }
});
function root(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "puzzle-navigation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function action(kind: NavigationAction["kind"], key: string): NavigationAction {
  return { kind, key, label: kind, x: 720, y: 2450 };
}
function fakeReader(
  map: Record<string, NavigationAction | undefined>,
): NavigationReader {
  return {
    async read(png) {
      const key = png.toString();
      return {
        action: map[key],
        reason:
          key === "board"
            ? "No supported completion overlay"
            : "Unknown screen",
      };
    },
    async close() {},
  };
}
test("bounded chain sends one tap per recognized screen and records before/after artifacts", async (t) => {
  const directory = root(t),
    frames = ["leader", "milestone", "next", "board"];
  let frame = 0;
  const taps: number[][] = [];
  const reader = fakeReader({
    leader: action("leaderboard", "leader"),
    milestone: action("continue", "milestone"),
    next: action("next-level", "next"),
  });
  const result = await advanceScreens({
    reader,
    runtimeRoot: directory,
    device: {
      screenshot() {
        return Buffer.from(frames[frame]!);
      },
      async wait() {},
      async tap(x, y) {
        taps.push([x, y]);
        frame++;
      },
    },
  });
  assert.equal(result.state, "board");
  assert.equal(result.actionsSent, 3);
  assert.equal(taps.length, 3);
  const files = readdirSync(join(directory, "navigation"));
  assert.equal(files.filter((file) => file.endsWith("-before.png")).length, 3);
  assert.equal(files.filter((file) => file.endsWith("-after.png")).length, 3);
  assert.equal(
    readFileSync(join(directory, "navigation/actions.jsonl"), "utf8")
      .trim()
      .split("\n").length,
    3,
  );
});
test("unknown overlay produces no input", async (t) => {
  let taps = 0;
  const result = await advanceScreens({
    runtimeRoot: root(t),
    reader: fakeReader({}),
    device: {
      screenshot() {
        return Buffer.from("unknown");
      },
      async wait() {},
      async tap() {
        taps++;
      },
    },
  });
  assert.equal(result.state, "waiting");
  assert.equal(taps, 0);
});
test("unstable confirmation screen produces no tap", async (t) => {
  let captures = 0,
    taps = 0;
  const result = await advanceScreens({
    runtimeRoot: root(t),
    reader: fakeReader({
      a: action("continue", "a"),
      b: action("next-level", "b"),
    }),
    device: {
      screenshot() {
        return Buffer.from(captures++ === 0 ? "a" : "b");
      },
      async wait() {},
      async tap() {
        taps++;
      },
    },
  });
  assert.equal(result.state, "waiting");
  assert.match(result.message, /changing/);
  assert.equal(taps, 0);
});
test("same control remaining after a tap is not replayed, even after restarting", async (t) => {
  const directory = root(t);
  let taps = 0;
  const options = {
    runtimeRoot: directory,
    reader: fakeReader({ leader: action("leaderboard", "leader") }),
    device: {
      screenshot() {
        return Buffer.from("leader");
      },
      async wait() {},
      async tap() {
        taps++;
      },
    },
  };
  assert.equal((await advanceScreens(options)).state, "blocked");
  assert.equal(taps, 1);
  assert.equal((await advanceScreens(options)).state, "blocked");
  assert.equal(taps, 1);
});
test("lost tap response leaves a marker that prevents blind retries", async (t) => {
  const directory = root(t);
  let taps = 0;
  const options = {
    runtimeRoot: directory,
    reader: fakeReader({ leader: action("leaderboard", "leader") }),
    device: {
      screenshot() {
        return Buffer.from("leader");
      },
      async wait() {},
      async tap() {
        taps++;
        throw new Error("Disconnected");
      },
    },
  };
  assert.equal((await advanceScreens(options)).state, "error");
  assert.equal((await advanceScreens(options)).state, "blocked");
  assert.equal(taps, 1);
});
test("dry run describes a recognized action without tapping or writing action artifacts", async (t) => {
  const directory = root(t);
  const result = await advanceScreens({
    runtimeRoot: directory,
    dryRun: true,
    reader: fakeReader({ leader: action("leaderboard", "leader") }),
    device: {
      screenshot() {
        return Buffer.from("leader");
      },
      async wait() {},
      async tap() {
        assert.fail();
      },
    },
  });
  assert.equal(result.state, "ready");
  assert.equal(existsSync(join(directory, "navigation")), false);
});
test("cancellation between captures prevents a navigation tap", async (t) => {
  const controller = new AbortController();
  const result = await advanceScreens({
    runtimeRoot: root(t),
    signal: controller.signal,
    reader: fakeReader({ leader: action("leaderboard", "leader") }),
    device: {
      screenshot() {
        return Buffer.from("leader");
      },
      async wait() {
        controller.abort();
      },
      async tap() {
        assert.fail();
      },
    },
  });
  assert.equal(result.actionsSent, 0);
});
test("leaving the overlay resets the guard for a later completed board", async (t) => {
  const directory = root(t);
  let frame = "leader",
    taps = 0;
  const options = {
    runtimeRoot: directory,
    reader: fakeReader({ leader: action("leaderboard", "leader") }),
    device: {
      screenshot() {
        return Buffer.from(frame);
      },
      async wait() {},
      async tap() {
        taps++;
        frame = "board";
      },
    },
  };
  assert.equal((await advanceScreens(options)).state, "board");
  assert.equal(taps, 1);
  frame = "leader";
  assert.equal((await advanceScreens(options)).state, "board");
  assert.equal(taps, 2);
});

test("waits for game status toasts to clear after opening the next board", async (t) => {
  let frame = "leader";
  let toastElapsed = 0;
  const captures: string[] = [];
  const device = {
    screenshot() {
      captures.push(frame);
      return Buffer.from(frame);
    },
    async wait(ms: number) {
      if (frame === "toast") {
        toastElapsed += ms;
        if (toastElapsed >= 3500) frame = "board";
      }
    },
    async tap() {
      frame = "toast";
    },
  };
  const reader: NavigationReader = {
    async read(png) {
      return png.toString() === "leader"
        ? { action: action("leaderboard", "leader"), reason: "Recognized" }
        : { reason: "No supported completion overlay" };
    },
    async close() {},
  };
  const result = await advanceScreens({ device, reader, runtimeRoot: root(t) });
  assert.equal(result.state, "board");
  assert.equal(result.actionsSent, 1);
  assert.equal(frame, "board");
  assert.equal(captures.at(-1), "board");
});
