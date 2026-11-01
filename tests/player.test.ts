import test from "node:test";
import assert from "node:assert/strict";
import { createPlayPlan } from "../src/levels/play-plan.ts";
import { placeCats } from "../src/android/cat-player.ts";

const geometry = {
  firstCenterX: 100,
  firstCenterY: 200,
  columnStep: 50,
  rowStep: 60,
};
const puzzle = {
  regions: Array.from({ length: 4 }, (_, row) => Array(4).fill(row)),
  fixedCats: [{ row: 0, col: 1 }],
};

test("plan solves uniquely, skips existing cats, and maps configurable coordinates", () => {
  assert.deepEqual(createPlayPlan(puzzle, geometry), [
    { row: 1, col: 3, x: 250, y: 260 },
    { row: 2, col: 0, x: 100, y: 320 },
    { row: 3, col: 2, x: 200, y: 380 },
  ]);
});
test("refuses ambiguous or impossible puzzles before sending any input", () => {
  assert.throws(() => createPlayPlan({ regions: puzzle.regions }, geometry));
  assert.throws(() =>
    createPlayPlan({ ...puzzle, blockedCells: [{ row: 0, col: 1 }] }, geometry),
  );
});
test("refuses invalid or incomplete geometry", () => {
  for (const bad of [
    { ...geometry, rowStep: 0 },
    { ...geometry, columnStep: NaN },
    { ...geometry, firstCenterX: -1 },
    { ...geometry, firstCenterY: undefined },
  ])
    assert.throws(() => createPlayPlan(puzzle, bad as typeof geometry));
});
test("player double-taps every remaining cat in order and checkpoints after settling", async () => {
  const events: string[] = [];
  const actions = createPlayPlan(puzzle, geometry);
  await placeCats(
    actions,
    {
      async tap(x, y) {
        events.push("tap " + x + "," + y);
      },
      async wait(ms) {
        assert.equal(ms, 700);
        events.push("wait");
      },
    },
    (action) => {
      events.push("placed " + action.row);
    },
  );
  assert.deepEqual(events, [
    "tap 250,260",
    "tap 250,260",
    "wait",
    "placed 1",
    "tap 100,320",
    "tap 100,320",
    "wait",
    "placed 2",
    "tap 200,380",
    "tap 200,380",
    "wait",
    "placed 3",
  ]);
});
test("device failure stops the sequence without retrying or marking a cat as placed", async () => {
  let taps = 0;
  let checkpoints = 0;
  await assert.rejects(
    placeCats(
      createPlayPlan(puzzle, geometry),
      {
        async tap() {
          taps++;
          throw new Error("Disconnected");
        },
        async wait() {
          assert.fail("Should stop on failure");
        },
      },
      () => {
        checkpoints++;
      },
    ),
    /Disconnected/,
  );
  assert.equal(taps, 1);
  assert.equal(checkpoints, 0);
});
test("fully placed board produces no actions", async () => {
  const complete = {
    ...puzzle,
    fixedCats: [
      { row: 0, col: 1 },
      { row: 1, col: 3 },
      { row: 2, col: 0 },
      { row: 3, col: 2 },
    ],
  };
  assert.deepEqual(createPlayPlan(complete, geometry), []);
  await placeCats([], {
    async tap() {
      assert.fail("Must not tap");
    },
    async wait() {
      assert.fail("Must not wait");
    },
  });
});
