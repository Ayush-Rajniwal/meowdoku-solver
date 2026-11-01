import { Command } from "commander";
export interface StartOptions {
  once: boolean;
  dryRun: boolean;
  pair: boolean;
  tui: boolean;
  autoAdvance: boolean;
}
export function startCommand(): Command {
  return new Command()
    .name("meowdoku-solver")
    .description("Read, solve, and play Meowdoku puzzles over ADB.")
    .option("--once", "Run one cycle and exit", false)
    .option("--dry-run", "Parse and solve without sending taps", false)
    .option("--pair", "Open wireless pairing setup before starting", false)
    .option("--no-tui", "Use plain logs for non-interactive execution")
    .option(
      "--no-auto-advance",
      "Leave completion screens for manual advancement",
    )
    .showHelpAfterError();
}
