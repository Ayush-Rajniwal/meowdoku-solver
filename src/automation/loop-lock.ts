import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
/** A PID lock prevents concurrent loops from creating separate attempts. */
export function acquireLoopLock(runtimeRoot: string): () => void {
  mkdirSync(runtimeRoot, { recursive: true });
  const file = join(runtimeRoot, "loop.lock");
  if (existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, "utf8")) as { pid: number };
    if (!Number.isInteger(previous.pid) || previous.pid <= 0)
      throw new Error(
        "Invalid runtime/loop.lock; inspect it before restarting",
      );
    let alive = true;
    try {
      process.kill(previous.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      else throw error;
    }
    if (alive)
      throw new Error("A loop is already running (PID " + previous.pid + ")");
    unlinkSync(file);
  }
  const token = randomUUID();
  writeFileSync(file, JSON.stringify({ pid: process.pid, token }) + "\n", {
    flag: "wx",
  });
  return () => {
    if (
      existsSync(file) &&
      (JSON.parse(readFileSync(file, "utf8")) as { token: string }).token ===
        token
    )
      unlinkSync(file);
  };
}
