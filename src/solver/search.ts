import type { Board, PlacementState, Position, SolveResult } from "./model.ts";
import { canPlace } from "./placement-rules.ts";

/** Backtracking search with minimum-remaining-values row selection. */
export function searchBoard(board: Board, limit: number): SolveResult {
  const state: PlacementState = {
    cats: new Map(),
    usedColumns: new Set(),
    usedRegions: new Set(),
  };
  const solutions: Position[][] = [];
  let visitedNodes = 0;
  let stoppedAtLimit = false;

  function place(row: number, col: number): void {
    state.cats.set(row, col);
    state.usedColumns.add(col);
    state.usedRegions.add(board.regions[row]![col]!);
  }

  function remove(row: number, col: number): void {
    state.cats.delete(row);
    state.usedColumns.delete(col);
    state.usedRegions.delete(board.regions[row]![col]!);
  }

  // Contradictory user marks are valid input, but have no satisfying solution.
  for (const { row, col } of board.fixedCats) {
    if (!canPlace(board, state, row, col))
      return { solutions: [], exhaustive: true, visitedNodes };
    place(row, col);
  }

  function visit(): void {
    visitedNodes++;
    if (state.cats.size === board.size) {
      solutions.push(
        [...state.cats]
          .sort(([a], [b]) => a - b)
          .map(([row, col]) => ({ row, col })),
      );
      stoppedAtLimit = solutions.length >= limit;
      return;
    }
    let chosenRow = -1;
    let candidates: number[] = [];
    for (let row = 0; row < board.size; row++) {
      if (state.cats.has(row)) continue;
      const legal: number[] = [];
      for (let col = 0; col < board.size; col++) {
        if (canPlace(board, state, row, col)) legal.push(col);
      }
      // Forward checking: an empty domain makes the entire branch impossible.
      if (legal.length === 0) return;
      if (chosenRow === -1 || legal.length < candidates.length) {
        chosenRow = row;
        candidates = legal;
      }
    }
    for (const col of candidates) {
      place(chosenRow, col);
      visit();
      remove(chosenRow, col);
      if (stoppedAtLimit) return;
    }
  }

  visit();
  return { solutions, exhaustive: !stoppedAtLimit, visitedNodes };
}
