import { Command } from "commander";
import { resolve } from "node:path";
import { prepareLevel } from "../levels/level-artifacts.ts";
const cli = new Command()
  .name("prepare-level")
  .description("Parse and solve a level input.png without tapping")
  .argument("<folder>", "Level folder")
  .action((folder: string) => {
    const directory = resolve(folder),
      plan = prepareLevel(directory);
    console.log(
      JSON.stringify(
        {
          directory,
          size: plan.boardSize,
          remainingCats: plan.taps.length,
          output: "output.json",
          preview: "preview.png",
        },
        null,
        2,
      ),
    );
  });
try {
  cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
