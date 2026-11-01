import { resolveAdbPath } from "../android/adb-path.ts";
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createAdbDevice } from "../android/adb-device.ts";
import { reserveLevelFolder } from "../levels/level-folder.ts";
const cli = new Command()
  .name("capture")
  .description("Capture a new level without tapping")
  .argument(
    "<name>",
    "A level name such as level-078, or golden-fish for the next ID",
  )
  .action((name: string) => {
    const root = fileURLToPath(new URL("../../levels/", import.meta.url));
    const adb = resolveAdbPath();
    const input = createAdbDevice(adb, process.env.ANDROID_SERIAL).screenshot();
    const directory = reserveLevelFolder(root, name);
    writeFileSync(join(directory, "input.png"), input, { flag: "wx" });
    console.log(directory);
  });
try {
  cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
