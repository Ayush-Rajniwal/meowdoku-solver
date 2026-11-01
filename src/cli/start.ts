import { resolveAdbPath } from "../android/adb-path.ts";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createAdbDevice, createAdbCommand } from "../android/adb-device.ts";
import { createConnection } from "../android/adb-connection.ts";
import { createHeaderReader } from "../vision/level-header.ts";
import { acquireLoopLock } from "../automation/loop-lock.ts";
import { solveAndAdvance } from "../automation/solve-and-advance.ts";
import { watchScreen } from "../automation/watch-screen.ts";
import { cleanupOnQuit } from "../maintenance/cleanup.ts";
import { ManualTrigger } from "../automation/manual-trigger.ts";
import { pairPhone } from "../android/pair-phone.ts";
import { createTerminalUi } from "../ui/terminal.tsx";
import type { TerminalUi } from "../ui/terminal.tsx";
import { startCommand } from "./start-options.ts";
import { createNavigationReader } from "../navigation/reader.ts";
import type { StartOptions } from "./start-options.ts";

const options = startCommand().parse().opts<StartOptions>();
const controller = new AbortController();
const trigger = new ManualTrigger();
let ui: TerminalUi | undefined;
const stop = () => {
  ui?.update({
    status: "stopping",
    stage: "Stopping",
    message: "Finishing cleanup",
  });
  controller.abort();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let release: (() => void) | undefined;
let cleanupRoot: string | undefined;
let reader: Awaited<ReturnType<typeof createHeaderReader>> | undefined;
let navigationReader:
  Awaited<ReturnType<typeof createNavigationReader>> | undefined;
try {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const runtimeRoot = join(root, "runtime");
  const connectionFile = join(runtimeRoot, "connection.json");
  release = acquireLoopLock(runtimeRoot);
  cleanupRoot = runtimeRoot;
  let running = false,
    pairRequested = false,
    checkRequested = false;
  const interactive =
    options.tui && !!process.stdin.isTTY && !!process.stdout.isTTY;
  ui = createTerminalUi(
    {
      solve() {
        checkRequested = true;
        trigger.request();
        ui!.update({ queued: running });
        ui!.note(
          running ? "Check queued after the current cycle" : "Checking now",
        );
      },
      pair() {
        pairRequested = true;
        checkRequested = true;
        trigger.request();
        ui!.update({ queued: running });
        ui!.note(
          running
            ? "Pairing queued after the current cycle"
            : "Opening pairing setup",
        );
      },
      stop,
    },
    {
      interactive,
      dryRun: options.dryRun,
      autoAdvance: options.autoAdvance,
    },
  );
  const adb = resolveAdbPath();
  const command = createAdbCommand(adb);
  let selectedSerial = process.env.ANDROID_SERIAL,
    selectedAddress = process.env.ADB_ADDRESS;
  let device = createAdbDevice(adb, selectedSerial, {
    connectionFile,
    address: selectedAddress,
  });
  async function setup(confirm = false): Promise<void> {
    ui!.update({
      status: "pairing",
      stage: "Pair phone",
      watching: false,
      placed: 0,
      total: 0,
    });
    if (
      confirm &&
      !(await ui!.confirm(
        "No phone connected. Pair a phone now?",
        controller.signal,
      ))
    )
      return;
    const paired = await pairPhone(command, connectionFile, {
      signal: controller.signal,
      log: (message) => ui!.note(message),
      question: (label) =>
        ui!.question(label, {
          secret: /pairing code/i.test(label),
          signal: controller.signal,
        }),
    });
    if (paired) {
      selectedSerial = paired.serial;
      selectedAddress = paired.address;
      device = createAdbDevice(adb, selectedSerial, {
        connectionFile,
        address: selectedAddress,
      });
      ui!.update({ connection: paired.address });
    }
  }
  if (options.pair) await setup();
  else if (!options.once && !options.dryRun && interactive) {
    try {
      const serial = createConnection(command, {
        serial: selectedSerial,
        address: selectedAddress,
        connectionFile,
      }).ensure();
      ui.update({ connection: serial });
    } catch {
      ui.update({ connection: "Disconnected" });
      await setup(true);
    }
  }
  if (!controller.signal.aborted) {
    ui.update({
      status: "starting",
      stage: "Loading local OCR",
      message: "Preparing automatic level naming",
    });
    reader = await createHeaderReader();
    if (options.autoAdvance) navigationReader = await createNavigationReader();
    await watchScreen({
      capture: () => device.screenshot(),
      takeRequest() {
        const requested = checkRequested;
        checkRequested = false;
        return requested;
      },
      onError(message) {
        ui!.update({
          status: "error",
          stage: "Connection",
          message,
          connection: "Disconnected",
        });
      },
      signal: controller.signal,
      once: options.once,
      async cycle() {
        running = true;
        ui!.update({
          status: "working",
          stage: "Checking board",
          watching: false,
          queued: false,
          placed: 0,
          total: 0,
        });
        try {
          if (pairRequested) {
            pairRequested = false;
            await setup();
            if (controller.signal.aborted)
              return { state: "waiting", message: "Stopped" };
          }
          const result = await solveAndAdvance({
            levelsRoot: join(root, "levels"),
            runtimeRoot,
            device,
            navigationReader,
            onNavigationProgress: (stage) =>
              ui!.update({ status: "working", stage }),
            identify: (png) => reader!.read(png),
            dryRun: options.dryRun,
            signal: controller.signal,
            onProgress: (progress) =>
              ui!.update({
                status: "working",
                stage: progress.label,
                ...(progress.stage === "parse"
                  ? { connection: selectedAddress ?? "Connected" }
                  : {}),
                ...(progress.level ? { level: progress.level } : {}),
                ...(progress.placed !== undefined
                  ? { placed: progress.placed, total: progress.total ?? 0 }
                  : {}),
              }),
          });
          ui!.update({
            status: result.state,
            stage: result.state === "played" ? "Taps complete" : "Waiting",
            message: result.message,
            ...(result.directory
              ? { level: result.directory.split("/").at(-1)! }
              : {}),
            ...(result.state === "error" &&
            /phone|offline|disconnected/i.test(result.message)
              ? { connection: "Disconnected" }
              : {}),
          });
          return result;
        } finally {
          running = false;
        }
      },
      async wait(ms, signal) {
        ui!.update({ watching: true });
        await trigger.wait(ms, signal);
      },
    });
  }
} catch (error) {
  if (!controller.signal.aborted) {
    const message = error instanceof Error ? error.message : String(error);
    if (ui) ui.update({ status: "error", stage: "Error", message });
    else console.error(message);
    process.exitCode = 1;
  }
} finally {
  controller.abort();
  try {
    await reader?.close();
    await navigationReader?.close();
  } finally {
    try {
      await ui?.close();
    } finally {
      try {
        if (release && cleanupRoot)
          cleanupOnQuit(cleanupRoot, release, console.error);
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
    }
  }
}
