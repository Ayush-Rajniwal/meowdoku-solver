import { createHash } from "node:crypto";
import { poll } from "./polling-loop.ts";
import type { CycleResult } from "./loop-cycle.ts";

export interface ScreenWatchOptions {
  signal: AbortSignal;
  once?: boolean;
  capture(): Buffer;
  cycle(): Promise<CycleResult>;
  takeRequest?(): boolean;
  onError?(message: string): void;
  now?: () => number;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

/** Samples the screen without OCR; only changes, explicit requests, and retries run the workflow. */
export async function watchScreen(options: ScreenWatchOptions): Promise<void> {
  const now = options.now ?? Date.now;
  let previous: string | undefined;
  let retryAt = 0,
    cooldownUntil = 0;
  await poll({
    intervalMs: 1000,
    signal: options.signal,
    once: options.once,
    now,
    wait: options.wait,
    async cycle() {
      const requested = options.takeRequest?.() ?? false;
      if (!requested && now() < cooldownUntil) return;
      // Requests bypass capture so pairing can open even when the phone is offline.
      if (!requested) {
        try {
          const fingerprint = createHash("sha256")
            .update(options.capture())
            .digest("hex");
          if (fingerprint === previous && now() < retryAt) return;
          previous = fingerprint;
        } catch (error) {
          options.onError?.(
            error instanceof Error ? error.message : String(error),
          );
          previous = undefined;
          cooldownUntil = now() + 5000;
          return;
        }
      }
      const result = await options.cycle();
      cooldownUntil = result.state === "error" ? now() + 5000 : 0;
      retryAt =
        result.state === "waiting" || result.state === "error"
          ? now() + 5000
          : Infinity;
      if (result.state === "played") {
        // A workflow can open a different board while running. Never cache its final frame.
        previous = undefined;
      }
    },
  });
}
