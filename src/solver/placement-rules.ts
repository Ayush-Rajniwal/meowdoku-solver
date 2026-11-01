import { cellKey } from "./model.ts";
import type { Board, PlacementState } from "./model.ts";

/** Checks only placement legality. It does not mutate state or run a search. */
export function canPlace(
  board: Board,
  state: PlacementState,
  row: number,
  col: number,
): boolean {
  if (
    row < 0 ||
    col < 0 ||
    row >= board.size ||
    col >= board.size ||
    !Number.isInteger(row) ||
    !Number.isInteger(col)
  )
    return false;
  if (
    state.cats.has(row) ||
    state.usedColumns.has(col) ||
    state.usedRegions.has(board.regions[row]![col]!) ||
    board.blocked.has(cellKey(row, col))
  )
    return false;
  for (const neighborRow of [row - 1, row + 1]) {
    const neighborCol = state.cats.get(neighborRow);
    if (neighborCol !== undefined && Math.abs(neighborCol - col) <= 1)
      return false;
  }
  return true;
}
