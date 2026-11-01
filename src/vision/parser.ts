import { createBoard } from "../solver/board.ts";
import { canPlace } from "../solver/placement-rules.ts";
import type { PlacementState, Position, Puzzle } from "../solver/model.ts";
import type { ScreenGeometry } from "../levels/play-plan.ts";
import { decodeScreenshot } from "./image.ts";
import type { PixelImage, Rgb } from "./image.ts";
import { detectGrid } from "./grid.ts";
import type { DetectedGrid } from "./grid.ts";
import { classifyRegions, sampleBackground } from "./background.ts";
import { detectMark } from "./marks.ts";
import type { CellMark } from "./marks.ts";

export interface ParsedScreen {
  readonly puzzle: Puzzle;
  readonly geometry: ScreenGeometry;
  readonly grid: DetectedGrid;
  readonly cellCenters: readonly (readonly { x: number; y: number }[])[];
  readonly palette: readonly Rgb[];
  readonly marks: readonly (readonly CellMark[])[];
  readonly minimumBackgroundAgreement: number;
}
export function parseImage(image: PixelImage): ParsedScreen {
  const grid = detectGrid(image);
  const samples = grid.cells.map((row) =>
    row.map((cell) => sampleBackground(image, cell)),
  );
  const { regions, palette } = classifyRegions(samples);
  const marks = grid.cells.map((row, r) =>
    row.map((cell, c) => detectMark(image, cell, samples[r]![c]!.rgb)),
  );
  const fixedCats: Position[] = [];
  marks.forEach((row, r) =>
    row.forEach((mark, c) => {
      if (mark === "cat") fixedCats.push({ row: r, col: c });
    }),
  );
  const puzzle: Puzzle = { regions, fixedCats };
  // X marks are user annotations, not additional game constraints.
  const board = createBoard(puzzle);
  const state: PlacementState = {
    cats: new Map(),
    usedColumns: new Set(),
    usedRegions: new Set(),
  };
  for (const { row, col } of fixedCats) {
    if (!canPlace(board, state, row, col))
      throw new Error("Detected cats violate the puzzle rules");
    state.cats.set(row, col);
    state.usedColumns.add(col);
    state.usedRegions.add(regions[row]![col]!);
  }
  const cellCenters = grid.cells.map((row) =>
    row.map((cell) => ({
      x: cell.x + (cell.width - 1) / 2,
      y: cell.y + (cell.height - 1) / 2,
    })),
  );
  const first = cellCenters[0]![0]!;
  const last = cellCenters.at(-1)!.at(-1)!;
  const geometry = {
    firstCenterX: first.x,
    firstCenterY: first.y,
    columnStep: (last.x - first.x) / (grid.size - 1),
    rowStep: (last.y - first.y) / (grid.size - 1),
  };
  return {
    puzzle,
    geometry,
    grid,
    cellCenters,
    palette,
    marks,
    minimumBackgroundAgreement: Math.min(
      ...samples.flat().map((sample) => sample.agreement),
    ),
  };
}
export function parseScreenshot(png: Buffer): ParsedScreen {
  return parseImage(decodeScreenshot(png));
}
