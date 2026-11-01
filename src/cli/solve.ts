import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { solvePuzzle } from "../solver/solver.ts";
const cli = new Command()
  .name("solve")
  .description("Solve a saved board JSON")
  .argument("<file>", "Puzzle JSON file")
  .argument("[limit]", "Maximum solutions, or all", "2")
  .action(async (file: string, limit: string) => {
    const result = solvePuzzle(JSON.parse(await readFile(file, "utf8")), {
      maxSolutions: limit === "all" ? Infinity : Number(limit),
    });
    console.log(JSON.stringify(result, null, 2));
  });
try {
  await cli.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
