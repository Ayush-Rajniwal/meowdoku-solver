import { sha256 } from "../levels/level-plan.ts";
import type { Puzzle } from "./model.ts";
/** Excludes cats, crosses, palette names, score, and animation pixels. */
export function boardFingerprint(puzzle: Puzzle): string {
  const ids = new Map<string | number, number>();
  const normalized = puzzle.regions.map((row) =>
    row.map((region) => {
      if (!ids.has(region)) ids.set(region, ids.size);
      return ids.get(region)!;
    }),
  );
  return sha256(JSON.stringify(normalized));
}
export function catsKey(puzzle: Puzzle): string {
  return [...(puzzle.fixedCats ?? [])]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((p) => p.row + "," + p.col)
    .join(";");
}
