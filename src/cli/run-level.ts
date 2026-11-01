import { resolveAdbPath } from "../android/adb-path.ts";
import { Command } from "commander";
import { resolve } from "node:path";
import { createAdbDevice } from "../android/adb-device.ts";
import { loadLevelPlan, runLevel } from "../levels/level-runner.ts";
const cli = new Command()
  .name("run-level")
  .description("Preview or execute a saved output.json")
  .argument("<folder>", "Level folder")
  .option("--execute", "Send the planned double-taps", false)
  .action(async (folder: string, options: { execute: boolean }) => {
    const directory = resolve(folder);
    if (!options.execute) {
      console.log(JSON.stringify(loadLevelPlan(directory).plan, null, 2));
      return;
    }
    const adb = resolveAdbPath();
    const result = await runLevel(
      directory,
      createAdbDevice(adb, process.env.ANDROID_SERIAL),
    );
    console.log(
      JSON.stringify(
        { directory, ...result, finalScreenshot: "final.png" },
        null,
        2,
      ),
    );
  });
try {
  await cli.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
