import { cycle } from "./loop-cycle.ts";
import type { CycleOptions, CycleResult } from "./loop-cycle.ts";
import { advanceScreens } from "../navigation/advance.ts";
import type { NavigationReader } from "../navigation/reader.ts";

export interface WorkflowOptions extends CycleOptions {
  navigationReader?: NavigationReader;
  onNavigationProgress?: (stage: string) => void;
}

/** Runs one complete workflow. Startup, scheduling, and terminal rendering live elsewhere. */
export async function solveAndAdvance(
  options: WorkflowOptions,
): Promise<CycleResult> {
  const { navigationReader, device } = options;
  const advance = navigationReader
    ? (directory?: string) =>
        advanceScreens({
          device,
          reader: navigationReader,
          runtimeRoot: options.runtimeRoot,
          directory,
          dryRun: options.dryRun,
          signal: options.signal,
          onProgress: options.onNavigationProgress,
        })
    : undefined;
  if (advance) {
    const before = await advance();
    if (
      before.state === "blocked" ||
      before.state === "error" ||
      before.state === "ready"
    ) {
      return { state: before.state, message: before.message };
    }
  }
  const result = await cycle(options);
  if (result.state !== "played" || !advance) return result;
  await device.wait(1500);
  const after = await advance(result.directory);
  return {
    ...result,
    state:
      after.state === "error" || after.state === "blocked"
        ? after.state
        : result.state,
    message:
      after.actionsSent > 0 ||
      after.state === "error" ||
      after.state === "blocked"
        ? after.message
        : "Cats placed. Automatic continuation will check again: " +
          after.message,
  };
}
