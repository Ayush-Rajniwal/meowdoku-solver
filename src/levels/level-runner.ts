import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayerDevice } from "../android/cat-player.ts";
import { placeCats } from "../android/cat-player.ts";
import { readLevelPlan, sha256 } from "./level-plan.ts";
import type { LevelPlan } from "./level-plan.ts";

export interface LevelDevice extends PlayerDevice {
  screenshot(): Buffer;
}
export interface ExecutionRecord {
  version: 1;
  planSha256: string;
  state: "running" | "taps-complete" | "failed";
  placedCats: number;
  error?: string;
  screenshotError?: string;
  verification?: string;
}
/** Loads coordinates from output.json. No solver or image recognition is invoked. */
export function loadLevelPlan(directory: string): {
  plan: LevelPlan;
  planSha256: string;
} {
  const bytes = readFileSync(join(directory, "output.json"));
  const plan = readLevelPlan(JSON.parse(bytes.toString("utf8")));
  if (sha256(readFileSync(join(directory, "input.png"))) !== plan.inputSha256) {
    throw new Error(
      "input.png has changed; prepare a new output.json before execution",
    );
  }
  return { plan, planSha256: sha256(bytes) };
}
/** Executes a stored plan exactly once and writes a screenshot even after a tap failure. */
export async function runLevel(
  directory: string,
  device: LevelDevice,
  onPlaced: (placed: number, total: number) => void = () => {},
): Promise<ExecutionRecord> {
  const { plan, planSha256 } = loadLevelPlan(directory);
  const recordFile = join(directory, "execution.json");
  if (existsSync(recordFile)) {
    const previous = JSON.parse(
      readFileSync(recordFile, "utf8"),
    ) as ExecutionRecord;
    if (
      previous.version === 1 &&
      previous.planSha256 === planSha256 &&
      previous.state === "taps-complete"
    ) {
      return previous;
    }
    throw new Error(
      "A previous execution exists; inspect final.png and execution.json before starting a new capture",
    );
  }
  const record: ExecutionRecord = {
    version: 1,
    planSha256,
    state: "running",
    placedCats: 0,
  };
  const save = () =>
    writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n");
  // Exclusive creation prevents two runners from playing the same level together.
  writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
  });
  let failure: unknown;
  try {
    await placeCats(plan.taps, device, () => {
      record.placedCats++;
      save();
      onPlaced(record.placedCats, plan.taps.length);
    });
    record.state = "taps-complete";
  } catch (error) {
    record.state = "failed";
    record.error = error instanceof Error ? error.message : String(error);
    failure = error;
  }
  try {
    writeFileSync(join(directory, "final.png"), device.screenshot());
  } catch (error) {
    record.state = "failed";
    record.screenshotError =
      error instanceof Error ? error.message : String(error);
    failure ??= error;
  }
  save();
  if (failure) throw failure;
  return record;
}
