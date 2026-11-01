import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import type { PlayerDevice } from "./cat-player.ts";
import { createConnection } from "./adb-connection.ts";
import type { AdbCommand } from "./adb-connection.ts";

export interface AdbDeviceOptions {
  connectionFile?: string;
  address?: string;
  command?: AdbCommand;
}
function connectionError(error: unknown): boolean {
  return /no devices|not found|offline|closed|disconnected|cannot connect|connection.*(reset|refused)|timed out/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
/** Transport captures stderr once. Reads may reconnect; taps are never replayed. */
export function createAdbDevice(
  adbPath: string,
  serial?: string,
  options: AdbDeviceOptions = {},
): PlayerDevice & { screenshot(): Buffer } {
  const command: AdbCommand = options.command ?? createAdbCommand(adbPath);
  const connection = createConnection(command, {
    serial,
    address: options.address ?? process.env.ADB_ADDRESS,
    connectionFile: options.connectionFile,
  });
  function run(target: string, args: string[]): Buffer {
    return command(["-s", target, ...args]);
  }
  return {
    async tap(x, y) {
      // One physical command only: retrying after a lost response could undo a cat.
      run(connection.target(), ["shell", "input", "tap", String(x), String(y)]);
    },
    async wait(milliseconds) {
      await setTimeout(milliseconds);
    },
    screenshot() {
      const target = connection.ensure();
      try {
        return run(target, ["exec-out", "screencap", "-p"]);
      } catch (error) {
        if (!connectionError(error)) throw error;
        return run(connection.ensure(), ["exec-out", "screencap", "-p"]);
      }
    },
  };
}

/** Shared command adapter; pairing errors never expose the code in a command string. */
export function createAdbCommand(adbPath: string): AdbCommand {
  return (args, timeoutMs = 15000) => {
    try {
      return execFileSync(adbPath, args, {
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as Error & { stderr?: Buffer; code?: string };
      if (failure.code === "ENOENT")
        throw new Error("ADB executable not found: " + adbPath);
      const detail = failure.stderr?.toString().trim().split("\n")[0];
      throw new Error(
        args[0] === "pair"
          ? "Pairing failed; check the current code and pairing port"
          : detail ||
              (failure.code === "ETIMEDOUT"
                ? "ADB command timed out"
                : failure.message),
      );
    }
  };
}
