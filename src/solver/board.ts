import { cellKey } from "./model.ts";
import type { Board, Position, RegionId } from "./model.ts";

function readPositions(value: unknown, name: string, size: number): Position[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (item === null || typeof item !== "object") {
      throw new Error(`${name} must contain row/col objects`);
    }
    const { row, col } = item as Position;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      row >= size ||
      col >= size
    ) {
      throw new Error(`${name} coordinate is outside the board`);
    }
    const key = cellKey(row, col);
    if (seen.has(key)) throw new Error(`${name} contains a duplicate cell`);
    seen.add(key);
    return { row, col };
  });
}

/** Validates untrusted JSON and takes a defensive snapshot of the input. */
export function createBoard(input: unknown): Board {
  if (input === null || typeof input !== "object")
    throw new Error("Puzzle must be an object");
  const puzzle = input as Record<string, unknown>;
  if (!Array.isArray(puzzle.regions) || puzzle.regions.length === 0) {
    throw new Error("regions must be a nonempty square grid");
  }
  const size = puzzle.regions.length;
  const distinct = new Set<RegionId>();
  const regions = Array.from(puzzle.regions, (row: unknown) => {
    if (!Array.isArray(row) || row.length !== size)
      throw new Error("regions must be a square grid");
    return Array.from(row, (region: unknown): RegionId => {
      if (
        !(typeof region === "string" && region.trim().length > 0) &&
        !(typeof region === "number" && Number.isFinite(region))
      ) {
        throw new Error(
          "Region IDs must be nonempty strings or finite numbers",
        );
      }
      distinct.add(region as RegionId);
      return region as RegionId;
    });
  });
  if (distinct.size !== size)
    throw new Error(`Expected ${size} distinct colors, found ${distinct.size}`);
  const fixedCats = readPositions(puzzle.fixedCats, "fixedCats", size);
  const blocked = new Set(
    readPositions(puzzle.blockedCells, "blockedCells", size).map(
      ({ row, col }) => cellKey(row, col),
    ),
  );
  return { size, regions, fixedCats, blocked };
}
