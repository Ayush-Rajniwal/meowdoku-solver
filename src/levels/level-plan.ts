import { createHash } from "node:crypto";
import { z } from "zod";
import type { Position } from "../solver/model.ts";
import type { TapAction } from "./play-plan.ts";
import type { ParsedScreen } from "../vision/parser.ts";
import { createPlayPlan } from "./play-plan.ts";

export interface LevelPlan {
  readonly version: 1;
  readonly inputSha256: string;
  readonly image: { readonly width: number; readonly height: number };
  readonly boardSize: number;
  readonly existingCats: readonly Position[];
  readonly taps: readonly TapAction[];
}
const index = z.number().int().nonnegative();
const position = z.object({ row: index, col: index });
const planSchema = z.object({
  version: z.literal(1),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  boardSize: z.number().int().positive(),
  existingCats: z.array(position),
  taps: z.array(position.extend({ x: index, y: index })),
});
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
export function buildLevelPlan(
  input: Buffer,
  parsed: ParsedScreen,
  width: number,
  height: number,
): LevelPlan {
  const taps = createPlayPlan(parsed.puzzle, parsed.geometry).map((action) => {
    const center = parsed.cellCenters[action.row]![action.col]!;
    return {
      row: action.row,
      col: action.col,
      x: Math.round(center.x),
      y: Math.round(center.y),
    };
  });
  return readLevelPlan({
    version: 1,
    inputSha256: sha256(input),
    image: { width, height },
    boardSize: parsed.grid.size,
    existingCats: parsed.puzzle.fixedCats ?? [],
    taps,
  });
}
/** Zod checks file shape; these remaining checks express puzzle-specific constraints. */
export function readLevelPlan(value: unknown): LevelPlan {
  const result = planSchema.safeParse(value);
  if (!result.success)
    throw new Error("Invalid output.json: " + result.error.issues[0]!.message);
  const plan = result.data,
    { boardSize: size, image, existingCats, taps } = plan;
  const all = [...existingCats, ...taps];
  if (all.some((p) => p.row >= size || p.col >= size))
    throw new Error("Invalid cat position in output.json");
  if (taps.some((p) => p.x >= image.width || p.y >= image.height))
    throw new Error("Tap is outside screenshot bounds");
  if (
    all.length !== size ||
    new Set(all.map((p) => p.row)).size !== size ||
    new Set(all.map((p) => p.col)).size !== size
  ) {
    throw new Error("Output must contain one cat per row and column");
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      if (
        Math.abs(all[i]!.row - all[j]!.row) <= 1 &&
        Math.abs(all[i]!.col - all[j]!.col) <= 1
      ) {
        throw new Error("Cats in output.json touch");
      }
    }
  if (new Set(taps.map((p) => p.x + "," + p.y)).size !== taps.length)
    throw new Error("Duplicate tap coordinates");
  return plan;
}
