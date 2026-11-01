import { solvePuzzle } from "../solver/solver.ts";
import { createBoard } from "../solver/board.ts";
import type { Position } from "../solver/model.ts";

export interface ScreenGeometry {
  readonly firstCenterX: number;
  readonly firstCenterY: number;
  readonly columnStep: number;
  readonly rowStep: number;
}
export interface TapAction extends Position {
  readonly x: number;
  readonly y: number;
}

/** Converts a uniquely solved board to screen coordinates; never touches ADB. */
export function createPlayPlan(
  puzzle: unknown,
  geometry: ScreenGeometry,
): TapAction[] {
  const { firstCenterX, firstCenterY, columnStep, rowStep } = geometry;
  if (
    ![firstCenterX, firstCenterY, columnStep, rowStep].every(Number.isFinite) ||
    firstCenterX < 0 ||
    firstCenterY < 0 ||
    columnStep <= 0 ||
    rowStep <= 0
  ) {
    throw new Error("Invalid screen geometry");
  }
  const board = createBoard(puzzle);
  const result = solvePuzzle(puzzle);
  if (result.solutions.length !== 1 || !result.exhaustive) {
    throw new Error("Require a proven unique solution before playing");
  }
  return result.solutions[0]!.filter(
    (p) => !board.fixedCats.some((f) => f.row === p.row && f.col === p.col),
  ).map((p) => ({
    ...p,
    x: Math.round(firstCenterX + p.col * columnStep),
    y: Math.round(firstCenterY + p.row * rowStep),
  }));
}
