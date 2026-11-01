export type RegionId = string | number;

/** Coordinates are zero-based. Board size is inferred from regions.length. */
export interface Position {
  readonly row: number;
  readonly col: number;
}

export interface Puzzle {
  readonly regions: readonly (readonly RegionId[])[];
  readonly fixedCats?: readonly Position[];
  readonly blockedCells?: readonly Position[];
}

export interface Board {
  readonly size: number;
  readonly regions: readonly (readonly RegionId[])[];
  readonly fixedCats: readonly Position[];
  readonly blocked: ReadonlySet<string>;
}

export interface PlacementState {
  readonly cats: Map<number, number>;
  readonly usedColumns: Set<number>;
  readonly usedRegions: Set<RegionId>;
}

export interface SolveOptions {
  /** Positive integer, or Infinity to enumerate every solution. Default: 2. */
  readonly maxSolutions?: number;
}

export interface SolveResult {
  readonly solutions: readonly (readonly Position[])[];
  /** False means search stopped at the limit; uniqueness is then unknown. */
  readonly exhaustive: boolean;
  readonly visitedNodes: number;
}

export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}
