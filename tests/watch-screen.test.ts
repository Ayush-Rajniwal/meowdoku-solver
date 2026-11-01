import test from "node:test";
import assert from "node:assert/strict";
import { watchScreen } from "../src/automation/watch-screen.ts";
import { ManualTrigger } from "../src/automation/manual-trigger.ts";

const png = (text: string) => Buffer.from(text);

test("unchanged screens skip the workflow; a new screen is processed on the next sample", async () => {
  const controller = new AbortController();
  let now = 0,
    frame = "one",
    captures = 0;
  const runs: string[] = [];
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture() {
      captures++;
      return png(frame);
    },
    async cycle() {
      runs.push(frame);
      return { state: "ready", message: "Preview ready" };
    },
    async wait(ms) {
      now += ms;
      if (now === 3000) frame = "two";
      if (now >= 5000) controller.abort();
    },
  });
  assert.deepEqual(runs, ["one", "two"]);
  assert.equal(captures, 5);
});

test("a slow successful solve immediately checks the newly opened board without overlap", async () => {
  const controller = new AbortController();
  let now = 0,
    frame = "one",
    active = false;
  const runs: string[] = [],
    waits: number[] = [];
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture: () => png(frame),
    async cycle() {
      assert.equal(active, false);
      active = true;
      runs.push(frame);
      await Promise.resolve();
      now += 20_000;
      active = false;
      if (runs.length === 2) controller.abort();
      frame = "two";
      return { state: "played", message: "Solved" };
    },
    async wait(ms) {
      waits.push(ms);
      now += ms;
    },
  });
  assert.deepEqual(runs, ["one", "two"]);
  assert.deepEqual(waits, [0]);
});

test("transient waiting screens are retried even when their pixels stay unchanged", async () => {
  const controller = new AbortController();
  let now = 0;
  const runs: number[] = [];
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture: () => png("static"),
    async cycle() {
      runs.push(now);
      if (runs.length === 2) controller.abort();
      return { state: "waiting", message: "Waiting for stable board" };
    },
    async wait(ms) {
      now += ms;
    },
  });
  assert.deepEqual(runs, [0, 5000]);
});

test("capture failures back off and a recovered unchanged screen gets a fresh workflow check", async () => {
  const controller = new AbortController();
  let now = 0;
  const captures: number[] = [],
    runs: number[] = [],
    errors: string[] = [];
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture() {
      captures.push(now);
      if (now === 1000) throw new Error("Phone offline");
      return png("same board");
    },
    onError: (message) => errors.push(message),
    async cycle() {
      runs.push(now);
      if (runs.length === 2) controller.abort();
      return { state: "ready", message: "Ready" };
    },
    async wait(ms) {
      now += ms;
    },
  });
  assert.deepEqual(captures, [0, 1000, 6000]);
  assert.deepEqual(runs, [0, 6000]);
  assert.deepEqual(errors, ["Phone offline"]);
});

test("workflow errors back off even while the screen keeps changing", async () => {
  const controller = new AbortController();
  let now = 0;
  const runs: number[] = [];
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture: () => png(String(now)),
    async cycle() {
      runs.push(now);
      if (runs.length === 2) controller.abort();
      return { state: "error", message: "Connection failed" };
    },
    async wait(ms) {
      now += ms;
    },
  });
  assert.deepEqual(runs, [0, 5000]);
});

test("a queued manual check runs once on unchanged pixels without overlapping work", async () => {
  const controller = new AbortController(),
    trigger = new ManualTrigger();
  let requested = false,
    calls = 0,
    now = 0;
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture: () => png("same"),
    takeRequest() {
      const value = requested;
      requested = false;
      return value;
    },
    async cycle() {
      calls++;
      if (calls === 1) {
        requested = true;
        trigger.request();
        trigger.request();
      }
      return { state: "ready", message: "Ready" };
    },
    async wait(ms, signal) {
      if (calls === 1) await trigger.wait(ms, signal);
      else {
        now += ms;
        if (now >= 3000) controller.abort();
      }
    },
  });
  assert.equal(calls, 2);
});

test("a pairing request can run during connection backoff without taking a screenshot", async () => {
  const controller = new AbortController();
  let now = 0,
    requested = false,
    captures = 0,
    cycles = 0;
  await watchScreen({
    signal: controller.signal,
    now: () => now,
    capture() {
      captures++;
      throw new Error("Offline");
    },
    takeRequest() {
      const value = requested;
      requested = false;
      return value;
    },
    async cycle() {
      cycles++;
      controller.abort();
      return { state: "waiting", message: "Paired" };
    },
    async wait(ms) {
      now += ms;
      requested = true;
    },
  });
  assert.equal(captures, 1);
  assert.equal(cycles, 1);
  assert.equal(now, 1000);
});

test("once mode runs one workflow and never waits", async () => {
  let calls = 0;
  await watchScreen({
    once: true,
    signal: new AbortController().signal,
    capture: () => png("board"),
    async cycle() {
      calls++;
      return { state: "played", message: "Done" };
    },
    async wait() {
      assert.fail("Once mode must not wait");
    },
  });
  assert.equal(calls, 1);
});

test("an already stopped watcher never captures the phone", async () => {
  const controller = new AbortController();
  controller.abort();
  await watchScreen({
    signal: controller.signal,
    capture() {
      assert.fail("Stopped watcher must not capture");
    },
    async cycle() {
      assert.fail("Stopped watcher must not run");
    },
    async wait() {
      assert.fail("Stopped watcher must not wait");
    },
  });
});
