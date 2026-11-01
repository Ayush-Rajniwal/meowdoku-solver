import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { solvePuzzle } from "../src/solver/solver.ts";
import { createBoard } from "../src/solver/board.ts";
import { canPlace } from "../src/solver/placement-rules.ts";
import type { Puzzle, Position, PlacementState } from "../src/solver/model.ts";

function rowColors(size: number): Puzzle {
  return {
    regions: Array.from({ length: size }, (_, row) => Array(size).fill(row)),
  };
}
function signature(cats: readonly Position[]): string {
  return [...cats]
    .sort((a, b) => a.row - b.row)
    .map((p) => p.col)
    .join(",");
}
// Independent verifier: never calls production placement rules.
function verify(puzzle: Puzzle, cats: readonly Position[]): void {
  const n = puzzle.regions.length;
  assert.equal(cats.length, n);
  assert.equal(new Set(cats.map((p) => p.row)).size, n);
  assert.equal(new Set(cats.map((p) => p.col)).size, n);
  assert.equal(new Set(cats.map((p) => puzzle.regions[p.row]![p.col])).size, n);
  for (const p of cats) {
    assert.ok(p.row >= 0 && p.row < n && p.col >= 0 && p.col < n);
    assert.ok(
      !puzzle.blockedCells?.some((b) => b.row === p.row && b.col === p.col),
    );
    for (const q of cats) {
      if (p !== q)
        assert.ok(
          Math.max(Math.abs(p.row - q.row), Math.abs(p.col - q.col)) > 1,
        );
    }
  }
  for (const p of puzzle.fixedCats ?? []) {
    assert.ok(cats.some((q) => q.row === p.row && q.col === p.col));
  }
}
// Simple permutation enumeration, independent of the optimized search.
function bruteForce(puzzle: Puzzle): string[] {
  const n = puzzle.regions.length;
  const answers: string[] = [];
  function enumerate(cols: number[]): void {
    if (cols.length === n) {
      const cats = cols.map((col, row) => ({ row, col }));
      if (new Set(cats.map((p) => puzzle.regions[p.row]![p.col])).size !== n)
        return;
      if (
        cols.some((col, row) => row > 0 && Math.abs(col - cols[row - 1]!) <= 1)
      )
        return;
      if (puzzle.fixedCats?.some((p) => cols[p.row] !== p.col)) return;
      if (puzzle.blockedCells?.some((p) => cols[p.row] === p.col)) return;
      answers.push(signature(cats));
      return;
    }
    for (let col = 0; col < n; col++) {
      if (!cols.includes(col)) enumerate([...cols, col]);
    }
  }
  enumerate([]);
  return answers.sort();
}

test("1x1 board has exactly one solution", () => {
  const result = solvePuzzle(rowColors(1), { maxSolutions: Infinity });
  assert.deepEqual(result.solutions, [[{ row: 0, col: 0 }]]);
  assert.equal(result.exhaustive, true);
});
test("2x2 and 3x3 boards cannot avoid touching", () => {
  for (const size of [2, 3]) {
    const result = solvePuzzle(rowColors(size));
    assert.deepEqual(result.solutions, []);
    assert.equal(result.exhaustive, true);
  }
});
test("4x4 enumerates both known solutions", () => {
  const result = solvePuzzle(rowColors(4), { maxSolutions: Infinity });
  assert.deepEqual(result.solutions.map(signature).sort(), [
    "1,3,0,2",
    "2,0,3,1",
  ]);
  assert.equal(result.exhaustive, true);
});
test("supports configurable sizes including 5, 9 and 12", () => {
  for (const size of [5, 9, 12]) {
    const puzzle = rowColors(size);
    const result = solvePuzzle(puzzle, { maxSolutions: 1 });
    assert.equal(result.solutions.length, 1);
    verify(puzzle, result.solutions[0]!);
  }
});
test("fixed cats constrain the result", () => {
  const puzzle = { ...rowColors(4), fixedCats: [{ row: 0, col: 1 }] };
  const result = solvePuzzle(puzzle, { maxSolutions: Infinity });
  assert.deepEqual(result.solutions.map(signature), ["1,3,0,2"]);
  verify(puzzle, result.solutions[0]!);
});
test("excluded cells eliminate solutions", () => {
  const puzzle = { ...rowColors(4), blockedCells: [{ row: 0, col: 1 }] };
  assert.deepEqual(
    solvePuzzle(puzzle, { maxSolutions: Infinity }).solutions.map(signature),
    ["2,0,3,1"],
  );
});
test("an entirely excluded row is impossible", () => {
  const puzzle = {
    ...rowColors(4),
    blockedCells: [0, 1, 2, 3].map((col) => ({ row: 2, col })),
  };
  assert.deepEqual(solvePuzzle(puzzle).solutions, []);
});
test("contradictory existing cats return no solution", () => {
  for (const fixedCats of [
    [
      { row: 0, col: 0 },
      { row: 0, col: 2 },
    ],
    [
      { row: 0, col: 0 },
      { row: 2, col: 0 },
    ],
    [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ],
  ])
    assert.deepEqual(solvePuzzle({ ...rowColors(4), fixedCats }).solutions, []);
  assert.deepEqual(
    solvePuzzle({
      ...rowColors(4),
      fixedCats: [{ row: 0, col: 1 }],
      blockedCells: [{ row: 0, col: 1 }],
    }).solutions,
    [],
  );
});
test("same color cannot be used twice, even far apart", () => {
  const puzzle: Puzzle = {
    regions: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 0],
    ],
    fixedCats: [
      { row: 0, col: 1 },
      { row: 3, col: 3 },
    ],
  };
  assert.deepEqual(solvePuzzle(puzzle).solutions, []);
});
test("placement rules reject each independent conflict and both diagonal directions", () => {
  const board = createBoard(rowColors(5));
  const state: PlacementState = {
    cats: new Map([[2, 2]]),
    usedColumns: new Set([2]),
    usedRegions: new Set([2]),
  };
  for (const [row, col] of [
    [2, 0],
    [0, 2],
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
    [-1, 0],
    [0, 5],
  ]) {
    assert.equal(canPlace(board, state, row!, col!), false);
  }
  assert.equal(canPlace(board, state, 1, 0), true);
  assert.equal(canPlace(board, state, 0, 1), true);
  const repeatedColor = createBoard({
    regions: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 0],
    ],
  });
  assert.equal(
    canPlace(
      repeatedColor,
      {
        cats: new Map([[0, 1]]),
        usedColumns: new Set([1]),
        usedRegions: new Set([0]),
      },
      3,
      3,
    ),
    false,
  );
});
test("rejects malformed boards and invalid coordinates", () => {
  for (const input of [
    null,
    {},
    { regions: [] },
    { regions: [[0, 1]] },
    {
      regions: [
        [0, 0],
        [0, 0],
      ],
    },
    {
      regions: [
        [0, 1],
        [2, 3],
      ],
    },
    { regions: [[null]] },
    { regions: [[" "]] },
    { regions: [[NaN]] },
    { regions: [[Infinity]] },
    { regions: [[{}]] },
    { regions: new Array(2) },
    { regions: [new Array(1)] },
    { ...rowColors(4), fixedCats: null },
    { ...rowColors(4), fixedCats: [{ row: 4, col: 0 }] },
    { ...rowColors(4), blockedCells: [{ row: 0.5, col: 0 }] },
    { ...rowColors(4), blockedCells: [{ row: 0, col: -1 }] },
    {
      ...rowColors(4),
      fixedCats: [
        { row: 0, col: 0 },
        { row: 0, col: 0 },
      ],
    },
  ])
    assert.throws(() => solvePuzzle(input));
});
test("rejects invalid search limits", () => {
  for (const maxSolutions of [0, -1, 1.5, NaN, -Infinity]) {
    assert.throws(() => solvePuzzle(rowColors(4), { maxSolutions }));
  }
});
test("limit stops search without claiming uniqueness", () => {
  const result = solvePuzzle(rowColors(4), { maxSolutions: 1 });
  assert.equal(result.solutions.length, 1);
  assert.equal(result.exhaustive, false);
  assert.equal(solvePuzzle(rowColors(4)).solutions.length, 2);
});
test("never mutates the puzzle and repeated calls are independent", () => {
  const puzzle = rowColors(4);
  const before = JSON.stringify(puzzle);
  Object.freeze(puzzle.regions);
  for (const row of puzzle.regions) Object.freeze(row);
  Object.freeze(puzzle);
  assert.deepEqual(solvePuzzle(puzzle), solvePuzzle(puzzle));
  assert.equal(JSON.stringify(puzzle), before);
});
test("numeric and string IDs are distinct colors", () => {
  const puzzle = {
    regions: [
      [0, 0, 0, 0],
      ["0", "0", "0", "0"],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
    ],
  };
  assert.equal(
    solvePuzzle(puzzle, { maxSolutions: Infinity }).solutions.length,
    2,
  );
});
test("matches independent brute force on 120 seeded boards (sizes 4–6)", () => {
  let seed = 17077;
  function random(n: number): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  }
  for (let sample = 0; sample < 120; sample++) {
    const n = 4 + (sample % 3);
    // Start from row stripes and perturb them, keeping every color represented.
    const regions = rowColors(n).regions.map((row) => [...row]);
    for (let k = 0; k < n * 2; k++)
      regions[random(n)]![1 + random(n - 1)] = random(n);
    const puzzle: Puzzle = {
      regions,
      fixedCats: sample % 4 === 0 ? [{ row: random(n), col: random(n) }] : [],
      blockedCells:
        sample % 3 === 0 ? [{ row: random(n), col: random(n) }] : [],
    };
    const result = solvePuzzle(puzzle, { maxSolutions: Infinity });
    assert.equal(result.exhaustive, true);
    assert.deepEqual(
      result.solutions.map(signature).sort(),
      bruteForce(puzzle),
      "sample " + sample,
    );
    for (const solution of result.solutions) verify(puzzle, solution);
  }
});
test("solves the captured 9x9 level without interacting with the phone", () => {
  const puzzle: Puzzle = JSON.parse(
    readFileSync(
      new URL("./fixtures/levels/level-077/reference.json", import.meta.url),
      "utf8",
    ),
  );
  const result = solvePuzzle(puzzle, { maxSolutions: Infinity });
  assert.ok(result.solutions.length > 0);
  assert.equal(result.exhaustive, true);
  for (const solution of result.solutions) verify(puzzle, solution);
});
