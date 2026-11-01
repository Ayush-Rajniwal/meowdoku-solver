import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { parseScreenshot } from "../vision/parser.ts";
import type { ParsedScreen } from "../vision/parser.ts";
import type { LevelHeader } from "../vision/level-header.ts";
import { boardFingerprint, catsKey } from "../solver/board-identity.ts";
import { createPlayPlan } from "../levels/play-plan.ts";
import { prepareLevel } from "../levels/level-artifacts.ts";
import { reserveLevelFolder } from "../levels/level-folder.ts";
import { runLevel } from "../levels/level-runner.ts";
import type { LevelDevice } from "../levels/level-runner.ts";
import { readLevelPlan } from "../levels/level-plan.ts";
import type { Puzzle } from "../solver/model.ts";
export interface CycleResult {
  state: "waiting" | "ready" | "played" | "blocked" | "error";
  message: string;
  directory?: string;
}
export interface CycleProgress {
  stage: "capture" | "parse" | "identify" | "solve" | "prepare" | "play";
  label: string;
  level?: string;
  placed?: number;
  total?: number;
}
export interface CycleOptions {
  levelsRoot: string;
  runtimeRoot: string;
  device: LevelDevice;
  identify(png: Buffer): Promise<LevelHeader>;
  onProgress?: (progress: CycleProgress) => void;
  dryRun?: boolean;
  signal?: AbortSignal;
}
function sameHeader(header: LevelHeader, name: string): boolean {
  return header.kind === "golden-fish"
    ? /^golden-fish-\d+$/.test(name)
    : new RegExp(
        "^level-" +
          String(header.number).padStart(3, "0") +
          "(?:-attempt-\\d+)?$",
      ).test(name);
}
function stable(a: ParsedScreen, b: ParsedScreen): boolean {
  return (
    boardFingerprint(a.puzzle) === boardFingerprint(b.puzzle) &&
    catsKey(a.puzzle) === catsKey(b.puzzle) &&
    Object.keys(a.geometry).every(
      (key) =>
        Math.abs(
          a.geometry[key as keyof typeof a.geometry] -
            b.geometry[key as keyof typeof b.geometry],
        ) <= 2,
    )
  );
}
function allocate(root: string, header: LevelHeader): string {
  if (header.kind === "golden-fish")
    return reserveLevelFolder(root, "golden-fish");
  const name = "level-" + String(header.number).padStart(3, "0");
  if (!existsSync(join(root, name))) return reserveLevelFolder(root, name);
  let attempt = 2;
  while (
    existsSync(
      join(root, name + "-attempt-" + String(attempt).padStart(3, "0")),
    )
  )
    attempt++;
  return reserveLevelFolder(
    root,
    name + "-attempt-" + String(attempt).padStart(3, "0"),
  );
}
/** One capture → parse → solve → play cycle. It never advances the game. */
export async function cycle(options: CycleOptions): Promise<CycleResult> {
  const { device, levelsRoot, runtimeRoot } = options;
  try {
    if (options.signal?.aborted)
      return { state: "waiting", message: "Stopped" };
    mkdirSync(runtimeRoot, { recursive: true });
    options.onProgress?.({ stage: "capture", label: "Capturing phone screen" });
    const first = device.screenshot();
    writeFileSync(join(runtimeRoot, "latest-screen.png"), first);
    options.onProgress?.({ stage: "parse", label: "Reading grid and colors" });
    let parsed: ParsedScreen;
    try {
      parsed = parseScreenshot(first);
    } catch (error) {
      return {
        state: "waiting",
        message: String(error instanceof Error ? error.message : error),
      };
    }
    await device.wait(800);
    if (options.signal?.aborted)
      return { state: "waiting", message: "Stopped" };
    const input = device.screenshot();
    writeFileSync(join(runtimeRoot, "latest-screen.png"), input);
    let current: ParsedScreen;
    try {
      current = parseScreenshot(input);
    } catch (error) {
      return {
        state: "waiting",
        message: String(error instanceof Error ? error.message : error),
      };
    }
    if (!stable(parsed, current))
      return {
        state: "waiting",
        message: "Board is changing; waiting for it to settle",
      };
    options.onProgress?.({ stage: "identify", label: "Reading level name" });
    let header: LevelHeader;
    try {
      header = await options.identify(input);
    } catch (error) {
      return {
        state: "waiting",
        message: String(error instanceof Error ? error.message : error),
      };
    }
    const fingerprint = boardFingerprint(current.puzzle);
    let prepared: string | undefined;
    if (existsSync(levelsRoot))
      for (const entry of readdirSync(levelsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !sameHeader(header, entry.name)) continue;
        const directory = join(levelsRoot, entry.name);
        const puzzleFile = join(directory, "analysis/puzzle.json");
        if (!existsSync(puzzleFile)) continue;
        const stored = JSON.parse(readFileSync(puzzleFile, "utf8")) as Puzzle;
        if (boardFingerprint(stored) !== fingerprint) continue;
        const recordFile = join(directory, "execution.json");
        if (existsSync(recordFile)) {
          const record = JSON.parse(readFileSync(recordFile, "utf8")) as {
            state: string;
          };
          return record.state === "taps-complete"
            ? {
                state: "waiting",
                message:
                  "Already played " +
                  entry.name +
                  ". Advance the phone to the next puzzle.",
                directory,
              }
            : {
                state: "blocked",
                message: "Previous attempt needs inspection: " + entry.name,
                directory,
              };
        }
        if (
          catsKey(stored) === catsKey(current.puzzle) &&
          existsSync(join(directory, "output.json"))
        ) {
          const output = readLevelPlan(
            JSON.parse(readFileSync(join(directory, "output.json"), "utf8")),
          );
          const image = decodeDimensions(input);
          if (
            output.image.width === image.width &&
            output.image.height === image.height &&
            output.taps.every((p) => {
              const center = current.cellCenters[p.row]?.[p.col];
              return (
                center &&
                Math.abs(center.x - p.x) <= 2 &&
                Math.abs(center.y - p.y) <= 2
              );
            })
          )
            prepared = directory;
        }
      }
    options.onProgress?.({
      stage: "solve",
      label: "Finding the unique solution",
    });
    let actions;
    try {
      actions = createPlayPlan(current.puzzle, current.geometry);
    } catch (error) {
      return {
        state: "waiting",
        message: String(error instanceof Error ? error.message : error),
      };
    }
    if (actions.length === 0)
      return {
        state: "waiting",
        message: "All cats are already present. Advance to the next puzzle.",
      };
    if (options.dryRun)
      return {
        state: "ready",
        message:
          "Dry run: " +
          current.grid.size +
          "x" +
          current.grid.size +
          ", " +
          actions.length +
          " cats, " +
          (prepared
            ? basename(prepared)
            : header.kind === "numbered"
              ? "level-" + header.number
              : "new golden-fish level"),
      };
    const directory = prepared ?? allocate(levelsRoot, header);
    if (!prepared) {
      writeFileSync(join(directory, "input.png"), input, { flag: "wx" });
      options.onProgress?.({
        stage: "prepare",
        label: "Saving solution and tap plan",
        level: basename(directory),
      });
      prepareLevel(directory);
    }
    // Cancellation is checked before each physical tap, including the second tap.
    const controlled: LevelDevice = {
      async tap(x, y) {
        if (options.signal?.aborted)
          throw new Error("Loop stopped during placement");
        await device.tap(x, y);
      },
      async wait(ms) {
        await device.wait(ms);
      },
      screenshot() {
        return device.screenshot();
      },
    };
    const placement = (placed: number, total: number) =>
      options.onProgress?.({
        stage: "play",
        label: "Placing cats",
        level: basename(directory),
        placed,
        total,
      });
    placement(0, actions.length);
    await runLevel(directory, controlled, placement);
    return {
      state: "played",
      message:
        "Placed " +
        actions.length +
        " cats in " +
        basename(directory) +
        ". Waiting for the next puzzle.",
      directory,
    };
  } catch (error) {
    return {
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
// Read dimensions without a second PNG decode.
function decodeDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
