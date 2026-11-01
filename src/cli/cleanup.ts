import { Command, InvalidArgumentError } from "commander";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { executeCleanup, planCleanup } from "../maintenance/cleanup.ts";

const cli = new Command()
  .name("cleanup")
  .description(
    "Preview removal of old runtime screenshots; level records and settings are preserved",
  )
  .option(
    "--older-than-days <days>",
    "Minimum screenshot age; 0 includes all runtime screenshots",
    (value) => {
      const days = Number(value);
      if (!value.trim() || !Number.isFinite(days) || days < 0)
        throw new InvalidArgumentError("Use a nonnegative number of days");
      return days;
    },
    7,
  )
  .option(
    "--execute",
    "Delete the previewed category of files; stop the controller first",
    false,
  )
  .action((options: { olderThanDays: number; execute: boolean }) => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const runtimeRoot = fileURLToPath(
      new URL("../../runtime/", import.meta.url),
    );
    const plan = options.execute
      ? executeCleanup(runtimeRoot, options.olderThanDays)
      : planCleanup(runtimeRoot, options.olderThanDays);
    for (const file of plan.files) console.log(relative(root, file.path));
    console.log(
      `${options.execute ? "Removed" : "Would remove"} ${plan.files.length} screenshots (${(plan.bytes / 1024 / 1024).toFixed(1)} MiB).`,
    );
    if (!options.execute)
      console.log(
        "Preview only. Add --execute to delete after stopping the controller.",
      );
  });
try {
  cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
