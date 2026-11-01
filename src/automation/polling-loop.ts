export interface PollOptions {
  intervalMs: number;
  signal: AbortSignal;
  once?: boolean;
  cycle(): Promise<void>;
  now?: () => number;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}
/** Runs immediately, then on the configured cadence. Cycles never overlap. */
export async function poll(options: PollOptions): Promise<void> {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0)
    throw new Error("Invalid loop interval");
  const now = options.now ?? Date.now;
  while (!options.signal.aborted) {
    const start = now();
    await options.cycle();
    if (options.once || options.signal.aborted) return;
    await options.wait(
      Math.max(0, options.intervalMs - (now() - start)),
      options.signal,
    );
  }
}
