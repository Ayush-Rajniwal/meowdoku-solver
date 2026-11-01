import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { parseScreenshot, parseImage } from "../src/vision/parser.ts";
import { solvePuzzle } from "../src/solver/solver.ts";
import { createPlayPlan } from "../src/levels/play-plan.ts";
import { decodeScreenshot } from "../src/vision/image.ts";
import type { PixelImage, Rgb } from "../src/vision/image.ts";
import type { Position, Puzzle } from "../src/solver/model.ts";

const palette: Rgb[] = [
  [200, 120, 118],
  [239, 183, 207],
  [103, 179, 177],
  [96, 116, 173],
  [243, 174, 119],
  [221, 189, 93],
  [221, 138, 181],
  [146, 121, 208],
  [183, 216, 155],
  [80, 140, 70],
  [160, 70, 90],
  [60, 120, 200],
];
function fill(
  image: PixelImage,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: Rgb,
): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const p = (yy * image.width + xx) * 4;
      image.data[p] = rgb[0];
      image.data[p + 1] = rgb[1];
      image.data[p + 2] = rgb[2];
      image.data[p + 3] = 255;
    }
}
function synthetic(size: number, cats: readonly Position[] = []): PixelImage {
  const width = 48 + size * 44 + (size - 1) * 5;
  const height = 100 + size * 44 + (size - 1) * 5;
  const image: PixelImage = {
    width,
    height,
    data: Buffer.alloc(width * height * 4, 255),
  };
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      fill(image, 24 + col * 49, 76 + row * 49, 44, 44, palette[row]!);
    }
  for (const cat of cats) {
    const x = 24 + cat.col * 49,
      y = 76 + cat.row * 49;
    fill(image, x + 10, y + 9, 24, 27, [40, 38, 40]);
    fill(image, x + 12, y + 27, 8, 8, [255, 255, 255]);
    fill(image, x + 24, y + 27, 8, 8, [255, 255, 255]);
  }
  return image;
}
// Compare region membership, not arbitrary numeric/color label names.
function normalize(regions: Puzzle["regions"]): number[][] {
  const ids = new Map<string | number, number>();
  return regions.map((row) =>
    row.map((region) => {
      if (!ids.has(region)) ids.set(region, ids.size);
      return ids.get(region)!;
    }),
  );
}
const expected: Puzzle = JSON.parse(
  readFileSync(
    new URL("./fixtures/levels/level-077/reference.json", import.meta.url),
    "utf8",
  ),
);
const initial = () =>
  readFileSync(
    new URL("./fixtures/levels/level-077/input.png", import.meta.url),
  );

test("real screenshot: all 81 region assignments match the manually labeled board", () => {
  const parsed = parseScreenshot(initial());
  assert.equal(parsed.grid.size, 9);
  assert.equal(parsed.palette.length, 9);
  assert.deepEqual(
    normalize(parsed.puzzle.regions),
    normalize(expected.regions),
  );
  assert.deepEqual(parsed.puzzle.fixedCats, expected.fixedCats);
  assert.equal(
    parsed.marks.flat().filter((mark) => mark === "cross").length,
    34,
  );
  assert.ok(parsed.minimumBackgroundAgreement >= 0.72);
});
test("real screenshot: recovered centers land inside every known cell", () => {
  const parsed = parseScreenshot(initial());
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const point = parsed.cellCenters[r]![c]!;
      assert.ok(Math.abs(point.x - (116 + 151 * c)) < 4);
      assert.ok(Math.abs(point.y - (1110 + 151 * r)) < 4);
    }
});
test("image → parsed board → solver → tap plan reproduces the verified solution", () => {
  const parsed = parseScreenshot(initial());
  assert.deepEqual(
    solvePuzzle(parsed.puzzle).solutions,
    solvePuzzle(expected).solutions,
  );
  const actions = createPlayPlan(parsed.puzzle, parsed.geometry);
  assert.equal(actions.length, 8);
  assert.ok(!actions.some((action) => action.row === 4 && action.col === 7));
  for (const action of actions) {
    const cell = parsed.grid.cells[action.row]![action.col]!;
    assert.ok(action.x > cell.x && action.x < cell.x + cell.width);
    assert.ok(action.y > cell.y && action.y < cell.y + cell.height);
  }
});
test("different settled capture gives identical board and cats", () => {
  const png = readFileSync(
    new URL("./fixtures/levels/level-077/debug/settled.png", import.meta.url),
  );
  const parsed = parseScreenshot(png);
  assert.deepEqual(
    normalize(parsed.puzzle.regions),
    normalize(expected.regions),
  );
  assert.deepEqual(parsed.puzzle.fixedCats, expected.fixedCats);
});
test("works at half screenshot resolution without configured size or geometry", () => {
  const original = decodeScreenshot(initial());
  const width = original.width / 2,
    height = original.height / 2;
  const small: PixelImage = {
    width,
    height,
    data: Buffer.alloc(width * height * 4),
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * 2 * original.width + x * 2) * 4,
        dest = (y * width + x) * 4;
      small.data.set(original.data.subarray(source, source + 4), dest);
    }
  const parsed = parseImage(small);
  assert.deepEqual(
    normalize(parsed.puzzle.regions),
    normalize(expected.regions),
  );
  assert.deepEqual(parsed.puzzle.fixedCats, expected.fixedCats);
});
test("detects generated 4x4, 5x5, 9x9 and 12x12 grids", () => {
  for (const size of [4, 5, 9, 12]) {
    const parsed = parseImage(synthetic(size));
    assert.equal(parsed.grid.size, size);
    assert.deepEqual(
      parsed.puzzle.regions,
      Array.from({ length: size }, (_, row) => Array(size).fill(row)),
    );
    assert.deepEqual(parsed.puzzle.fixedCats, []);
  }
});
test("cat detection and white crosses are separate from background color", () => {
  const image = synthetic(4, [{ row: 0, col: 1 }]);
  const x = 24 + 2 * 49,
    y = 76 + 2 * 49;
  for (let k = 9; k < 35; k++) {
    fill(image, x + k, y + k, 3, 3, [255, 255, 255]);
    fill(image, x + k, y + 43 - k, 3, 3, [255, 255, 255]);
  }
  const parsed = parseImage(image);
  assert.deepEqual(parsed.puzzle.fixedCats, [{ row: 0, col: 1 }]);
  assert.equal(parsed.marks[2]![2], "cross");
  assert.deepEqual(parsed.puzzle.regions[2], [2, 2, 2, 2]);
  assert.equal(parsed.puzzle.blockedCells, undefined);
});
test("rejects non-grid screenshots and incomplete boards", () => {
  const blank: PixelImage = {
    width: 500,
    height: 900,
    data: Buffer.alloc(500 * 900 * 4, 255),
  };
  assert.throws(() => parseImage(blank), /No complete puzzle grid/);
  const image = synthetic(5);
  fill(image, 24 + 2 * 49, 76 + 2 * 49, 44, 44, [255, 255, 255]);
  assert.throws(() => parseImage(image), /No complete puzzle grid/);
});
test("rejects conflicting detected cats", () => {
  assert.throws(
    () =>
      parseImage(
        synthetic(4, [
          { row: 0, col: 0 },
          { row: 1, col: 1 },
        ]),
      ),
    /violate the puzzle rules/,
  );
});
test("rejects obscured cell centers instead of silently treating them as empty", () => {
  const image = synthetic(4);
  fill(image, 24 + 12, 76 + 12, 20, 20, [30, 30, 30]);
  assert.throws(() => parseImage(image), /Unrecognized cell contents/);
});
test("rejects ambiguous multiple grids", () => {
  const source = synthetic(4);
  const image: PixelImage = {
    width: source.width,
    height: source.height * 2 + 50,
    data: Buffer.alloc(source.width * (source.height * 2 + 50) * 4, 255),
  };
  for (let y = 0; y < source.height; y++) {
    const line = source.data.subarray(
      y * source.width * 4,
      (y + 1) * source.width * 4,
    );
    image.data.set(line, y * image.width * 4);
    image.data.set(line, (y + source.height + 50) * image.width * 4);
  }
  assert.throws(() => parseImage(image), /Multiple puzzle grids/);
});
test("rejects real placement animations and victory overlay", () => {
  for (const file of [
    "step-0-2.png",
    "step-1-2.png",
    "step-2-2.png",
    "step-3-2.png",
    "after-play.png",
  ]) {
    const png = readFileSync(
      new URL(
        file === "after-play.png"
          ? "./fixtures/levels/level-077/final.png"
          : "./fixtures/levels/level-077/debug/" + file,
        import.meta.url,
      ),
    );
    assert.throws(
      () => parseScreenshot(png),
      /grid|obscured|animated|cell|color/,
    );
  }
});
test("PNG decoding preserves generated image pixels", () => {
  const image = synthetic(4);
  const encoded = new PNG({ width: image.width, height: image.height });
  encoded.data.set(image.data);
  const png = PNG.sync.write(encoded);
  assert.deepEqual(parseScreenshot(png).puzzle, parseImage(image).puzzle);
});

test("fresh 10x10 phone screenshot: all 100 colors match a second manually labeled board", () => {
  const png = readFileSync(
    new URL("./fixtures/levels/golden-fish-001/input.png", import.meta.url),
  );
  const truth: Puzzle = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/levels/golden-fish-001/reference.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const parsed = parseScreenshot(png);
  assert.equal(parsed.grid.size, 10);
  assert.equal(parsed.palette.length, 10);
  assert.deepEqual(normalize(parsed.puzzle.regions), normalize(truth.regions));
  assert.deepEqual(parsed.puzzle.fixedCats, []);
  assert.ok(parsed.marks.flat().every((mark) => mark === "empty"));
  const result = solvePuzzle(parsed.puzzle);
  assert.equal(result.solutions.length, 1);
  assert.equal(result.exhaustive, true);
  assert.deepEqual(result.solutions, solvePuzzle(truth).solutions);
  assert.equal(createPlayPlan(parsed.puzzle, parsed.geometry).length, 10);
});

test("real level 140 parses existing cats and eight crosses without treating crosses as constraints", () => {
  const png = readFileSync(
    new URL("./fixtures/vision/crosses-level-140.png", import.meta.url),
  );
  const parsed = parseScreenshot(png);
  assert.equal(parsed.grid.size, 10);
  assert.deepEqual(parsed.puzzle.fixedCats, [
    { row: 0, col: 9 },
    { row: 1, col: 0 },
  ]);
  const crosses = parsed.marks.flatMap((row, r) =>
    row.flatMap((mark, c) => (mark === "cross" ? [{ row: r, col: c }] : [])),
  );
  assert.deepEqual(crosses, [
    { row: 5, col: 2 },
    { row: 5, col: 3 },
    { row: 5, col: 4 },
    { row: 6, col: 2 },
    { row: 6, col: 3 },
    { row: 7, col: 3 },
    { row: 8, col: 4 },
    { row: 9, col: 4 },
  ]);
  assert.equal(parsed.puzzle.blockedCells, undefined);
  const expectedRegions = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [0, 2, 2, 2, 3, 3, 3, 3, 0, 1],
    [2, 2, 2, 2, 3, 3, 3, 3, 4, 4],
    [2, 5, 2, 3, 3, 6, 3, 3, 3, 4],
    [5, 5, 2, 2, 3, 6, 6, 7, 3, 3],
    [5, 2, 2, 3, 3, 6, 6, 7, 7, 3],
    [5, 8, 2, 3, 3, 3, 3, 3, 7, 3],
    [5, 8, 3, 3, 9, 9, 7, 7, 7, 3],
    [5, 8, 8, 3, 9, 7, 7, 3, 3, 3],
    [5, 5, 8, 9, 9, 3, 3, 3, 3, 3],
  ];
  assert.deepEqual(
    normalize(parsed.puzzle.regions),
    normalize(expectedRegions),
  );
  const plan = createPlayPlan(parsed.puzzle, parsed.geometry);
  assert.equal(plan.length, 8);
});
