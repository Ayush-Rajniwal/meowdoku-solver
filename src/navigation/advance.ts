import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { LevelDevice } from "../levels/level-runner.ts";
import type { NavigationAction, NavigationReader } from "./reader.ts";

export interface AdvancementResult {
  state: "board" | "waiting" | "blocked" | "ready" | "error";
  actionsSent: number;
  message: string;
}
export interface AdvancementOptions {
  device: LevelDevice;
  reader: NavigationReader;
  runtimeRoot: string;
  directory?: string;
  dryRun?: boolean;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}
interface LastAction {
  key: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  time: string;
}
function equivalent(a: NavigationAction, b: NavigationAction): boolean {
  return (
    a.key === b.key && Math.abs(a.x - b.x) <= 8 && Math.abs(a.y - b.y) <= 8
  );
}
/** A bounded chain of recognized completion screens; never solves or guesses buttons. */
export async function advanceScreens(
  options: AdvancementOptions,
): Promise<AdvancementResult> {
  const { device, reader, runtimeRoot } = options;
  let actionsSent = 0;
  try {
    mkdirSync(runtimeRoot, { recursive: true });
    const stateFile = join(runtimeRoot, "navigation-state.json");
    let last: LastAction | undefined = existsSync(stateFile)
      ? (JSON.parse(readFileSync(stateFile, "utf8")) as LastAction)
      : undefined;
    let png = device.screenshot();
    for (let step = 0; step < 6; step++) {
      if (options.signal?.aborted)
        return { state: "waiting", actionsSent, message: "Stopped" };
      options.onProgress?.("Inspecting completion screen");
      let decision = await reader.read(png);
      // Game status toasts can briefly cover the newly opened puzzle.
      if (
        !decision.action &&
        decision.reason === "No supported completion overlay" &&
        actionsSent > 0
      ) {
        await device.wait(3000);
        if (options.signal?.aborted)
          return { state: "waiting", actionsSent, message: "Stopped" };
        png = device.screenshot();
        decision = await reader.read(png);
      }
      if (!decision.action) {
        if (decision.reason === "No supported completion overlay") {
          // Clear only when the overlay has gone, so later boards can use the same labels.
          writeFileSync(stateFile, "null\n");
          return {
            state: "board",
            actionsSent,
            message: actionsSent
              ? "Continuation finished; checking the next board"
              : decision.reason,
          };
        }
        return { state: "waiting", actionsSent, message: decision.reason };
      }
      const action = decision.action;
      if (last?.key === action.key) {
        return {
          state: "blocked",
          actionsSent,
          message:
            "The last continuation control is still visible; waiting instead of tapping it twice",
        };
      }
      await device.wait(450);
      if (options.signal?.aborted)
        return { state: "waiting", actionsSent, message: "Stopped" };
      const confirmation = device.screenshot();
      decision = await reader.read(confirmation);
      if (!decision.action || !equivalent(action, decision.action)) {
        return {
          state: "waiting",
          actionsSent,
          message: "Completion screen is changing; waiting for it to settle",
        };
      }
      if (options.dryRun)
        return {
          state: "ready",
          actionsSent,
          message:
            "Would tap " + action.label + " at " + action.x + ", " + action.y,
        };
      const artifacts = options.directory
        ? join(options.directory, "advancement")
        : join(runtimeRoot, "navigation");
      mkdirSync(artifacts, { recursive: true });
      const name = Date.now() + "-" + step;
      writeFileSync(join(artifacts, name + "-before.png"), confirmation);
      last = { ...action, time: new Date().toISOString() };
      // Save before the physical input: even a lost response must not replay this tap.
      writeFileSync(stateFile, JSON.stringify(last, null, 2) + "\n");
      appendFileSync(
        join(artifacts, "actions.jsonl"),
        JSON.stringify(last) + "\n",
      );
      options.onProgress?.("Continuing: " + action.label);
      if (options.signal?.aborted)
        return { state: "waiting", actionsSent, message: "Stopped" };
      await device.tap(action.x, action.y);
      actionsSent++;
      await device.wait(1400);
      png = device.screenshot();
      writeFileSync(join(artifacts, name + "-after.png"), png);
      // The next frame may still show an animation from the prior screen.
      const next = await reader.read(png);
      if (next.action && equivalent(action, next.action)) {
        await device.wait(1200);
        png = device.screenshot();
      }
    }
    return {
      state: "waiting",
      actionsSent,
      message: "Continuation limit reached; checking again on the next cycle",
    };
  } catch (error) {
    return {
      state: "error",
      actionsSent,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
