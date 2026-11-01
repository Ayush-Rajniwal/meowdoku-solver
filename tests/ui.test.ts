import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, cleanup } from "ink-testing-library";
import { setTimeout as delay } from "node:timers/promises";
import { Dashboard } from "../src/ui/dashboard.tsx";
import type { DashboardState } from "../src/ui/dashboard.tsx";
import { startCommand } from "../src/cli/start-options.ts";
const state: DashboardState = {
  status: "waiting",
  stage: "Waiting",
  message: "Advance on the phone",
  connection: "192.0.2.10:34375",
  level: "golden-fish-002",
  placed: 9,
  total: 9,
  queued: false,
  dryRun: false,
  watching: true,
};
test("dashboard displays connection, level, progress, and user controls", async (t) => {
  t.after(cleanup);
  const view = render(
    createElement(Dashboard, {
      state,
      actions: { solve() {}, pair() {}, stop() {} },
    }),
  );
  await delay(60);
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /Meowdoku Solver/);
  assert.match(frame, /192\.0\.2\.10:34375/);
  assert.match(frame, /golden-fish-002/);
  assert.match(frame, /Cats: 9\/9/);
  assert.match(frame, /a solve now/);
  assert.match(frame, /Watching for screen changes/);
});
test("Ink routes a and p hotkeys and Ctrl+C without needing Enter", async (t) => {
  t.after(cleanup);
  let solve = 0,
    pair = 0,
    stop = 0;
  const view = render(
    createElement(Dashboard, {
      state,
      actions: {
        solve() {
          solve++;
        },
        pair() {
          pair++;
        },
        stop() {
          stop++;
        },
      },
    }),
  );
  await delay(50);
  view.stdin.write("a");
  await delay(30);
  view.stdin.write("p");
  await delay(30);
  view.stdin.write("\u0003");
  await delay(30);
  assert.equal(solve, 1);
  assert.equal(pair, 1);
  assert.equal(stop, 1);
});
test("text input receives address characters without activating dashboard hotkeys", async (t) => {
  t.after(cleanup);
  let actions = 0,
    answer = "";
  const prompt = {
    id: 1,
    label: "Pairing IP:port",
    kind: "text" as const,
    submit(value: string) {
      answer = value;
    },
  };
  const view = render(
    createElement(Dashboard, {
      state: { ...state, status: "pairing", prompt },
      actions: {
        solve() {
          actions++;
        },
        pair() {
          actions++;
        },
        stop() {
          actions++;
        },
      },
    }),
  );
  await delay(50);
  view.stdin.write("android.local:12345");
  await delay(50);
  view.stdin.write("\r");
  await delay(50);
  assert.equal(answer, "android.local:12345");
  assert.equal(actions, 0);
});
test("pairing code is masked in every rendered frame", async (t) => {
  t.after(cleanup);
  let answer = "";
  const view = render(
    createElement(Dashboard, {
      state: {
        ...state,
        status: "pairing",
        prompt: {
          id: 2,
          label: "Six-digit pairing code",
          kind: "password",
          submit(value) {
            answer = value;
          },
        },
      },
      actions: { solve() {}, pair() {}, stop() {} },
    }),
  );
  await delay(50);
  view.stdin.write("123456");
  await delay(50);
  assert.ok(view.frames.every((frame) => !frame.includes("123456")));
  assert.match(view.lastFrame() ?? "", /\*{6}/);
  view.stdin.write("\r");
  await delay(50);
  assert.equal(answer, "123456");
});
test("Escape cancels a pairing field without issuing another app action", async (t) => {
  t.after(cleanup);
  let answer = "not submitted",
    actions = 0;
  const view = render(
    createElement(Dashboard, {
      state: {
        ...state,
        status: "pairing",
        prompt: {
          id: 3,
          label: "Connection IP:port",
          kind: "text",
          submit(value) {
            answer = value;
          },
        },
      },
      actions: {
        solve() {
          actions++;
        },
        pair() {
          actions++;
        },
        stop() {
          actions++;
        },
      },
    }),
  );
  await delay(50);
  view.stdin.write("\u001b");
  await delay(100);
  assert.equal(answer, "");
  assert.equal(actions, 0);
});
test("Commander owns CLI defaults, flags, unknown-option errors, and help", () => {
  const make = () =>
    startCommand()
      .exitOverride()
      .configureOutput({ writeOut() {}, writeErr() {} });
  assert.deepEqual(make().parse([], { from: "user" }).opts(), {
    once: false,
    dryRun: false,
    pair: false,
    tui: true,
    autoAdvance: true,
  });
  assert.deepEqual(
    make()
      .parse(["--once", "--dry-run", "--pair", "--no-tui"], { from: "user" })
      .opts(),
    { once: true, dryRun: true, pair: true, tui: false, autoAdvance: true },
  );
  assert.equal(
    make().parse(["--no-auto-advance"], { from: "user" }).opts().autoAdvance,
    false,
  );
  assert.throws(
    () => make().parse(["--typo"], { from: "user" }),
    /unknown option/,
  );
  assert.throws(
    () => make().parse(["--help"], { from: "user" }),
    (error) => (error as { code: string }).code === "commander.helpDisplayed",
  );
});
