import { existsSync, lstatSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { acquireLoopLock } from "../automation/loop-lock.ts";

export interface CleanupFile {
  path: string;
  bytes: number;
}
export interface CleanupPlan {
  files: CleanupFile[];
  bytes: number;
}

/** Only diagnostic PNGs directly under runtime/ or runtime/navigation/ are disposable. */
export function planCleanup(
  runtimeRoot: string,
  olderThanDays = 7,
  now = Date.now(),
): CleanupPlan {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0)
    throw new Error("Age must be a nonnegative number of days");
  const files: CleanupFile[] = [];
  const cutoff = now - olderThanDays * 86_400_000;
  if (existsSync(runtimeRoot) && lstatSync(runtimeRoot).isSymbolicLink())
    throw new Error("Refusing to clean a symlinked runtime folder");
  for (const directory of [runtimeRoot, join(runtimeRoot, "navigation")]) {
    if (!existsSync(directory)) continue;
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    for (const name of readdirSync(directory).sort()) {
      if (!name.endsWith(".png")) continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs <= cutoff)
        files.push({ path, bytes: stat.size });
    }
  }
  return { files, bytes: files.reduce((total, file) => total + file.bytes, 0) };
}

/** Rebuilds the plan under the same exclusive lock used by the running controller. */
export function executeCleanup(
  runtimeRoot: string,
  olderThanDays = 7,
): CleanupPlan {
  // Check the root before the lock can create or modify anything inside it.
  planCleanup(runtimeRoot, olderThanDays);
  const release = acquireLoopLock(runtimeRoot);
  try {
    return removeScreenshots(runtimeRoot, olderThanDays);
  } finally {
    release();
  }
}

function removeScreenshots(
  runtimeRoot: string,
  olderThanDays: number,
): CleanupPlan {
  const plan = planCleanup(runtimeRoot, olderThanDays);
  for (const file of plan.files) unlinkSync(file.path);
  return plan;
}

/** The session still owns the controller lock; release it only after cleanup finishes. */
export function cleanupOnQuit(
  runtimeRoot: string,
  release: () => void,
  onError: (message: string) => void,
): CleanupPlan | undefined {
  try {
    return removeScreenshots(runtimeRoot, 0);
  } catch (error) {
    onError(
      "Runtime screenshot cleanup failed: " +
        (error instanceof Error ? error.message : String(error)),
    );
    return undefined;
  } finally {
    release();
  }
}
