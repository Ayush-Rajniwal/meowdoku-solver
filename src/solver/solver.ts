import { createBoard } from "./board.ts";
import { searchBoard } from "./search.ts";
import type { SolveOptions, SolveResult } from "./model.ts";

export type {
  Puzzle,
  Position,
  RegionId,
  SolveOptions,
  SolveResult,
} from "./model.ts";

/** Public entry point, also accepting untrusted data from a screen parser or JSON. */
export function solvePuzzle(
  puzzle: unknown,
  options: SolveOptions = {},
): SolveResult {
  const limit = options.maxSolutions ?? 2;
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("maxSolutions must be a positive integer or Infinity");
  }
  return searchBoard(createBoard(puzzle), limit);
}
