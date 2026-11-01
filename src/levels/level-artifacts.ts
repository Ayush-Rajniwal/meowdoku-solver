import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeScreenshot } from "../vision/image.ts";
import { parseImage } from "../vision/parser.ts";
import { renderPreview } from "../vision/preview.ts";
import { solvePuzzle } from "../solver/solver.ts";
import { buildLevelPlan } from "./level-plan.ts";
import type { LevelPlan } from "./level-plan.ts";

/** Reads one level's input and writes its derived artifacts; never calls ADB. */
export function prepareLevel(directory: string): LevelPlan {
  if (existsSync(join(directory, "execution.json"))) {
    throw new Error(
      "This level already has an execution record; capture a new level folder to prepare another run",
    );
  }
  const input = readFileSync(join(directory, "input.png"));
  const image = decodeScreenshot(input);
  const parsed = parseImage(image);
  const plan = buildLevelPlan(input, parsed, image.width, image.height);
  const analysis = join(directory, "analysis");
  mkdirSync(analysis, { recursive: true });
  const save = (name: string, value: unknown) =>
    writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + "\n");
  save("analysis/puzzle.json", parsed.puzzle);
  save("analysis/geometry.json", parsed.geometry);
  save("analysis/diagnostics.json", {
    size: parsed.grid.size,
    palette: parsed.palette,
    marks: parsed.marks,
    minimumBackgroundAgreement: parsed.minimumBackgroundAgreement,
  });
  save("analysis/solution.json", solvePuzzle(parsed.puzzle));
  writeFileSync(
    join(directory, "preview.png"),
    renderPreview(image, parsed, plan.taps),
  );
  save("output.json", plan);
  return plan;
}
