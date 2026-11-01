import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Allocates a new named folder without replacing a prior level. */
export function reserveLevelFolder(
  root: string,
  requestedName: string,
): string {
  mkdirSync(root, { recursive: true });
  let name = requestedName;
  const numbered = /^level-(\d+)$/.exec(name);
  if (numbered) name = "level-" + numbered[1]!.padStart(3, "0");
  if (name === "golden-fish") {
    const ids = readdirSync(root)
      .map((entry) => /^golden-fish-(\d+)$/.exec(entry))
      .filter((match) => match !== null)
      .map((match) => Number(match![1]));
    name = "golden-fish-" + String(Math.max(0, ...ids) + 1).padStart(3, "0");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error("Use a level name such as level-078 or golden-fish");
  const directory = join(root, name);
  mkdirSync(directory); // EEXIST is deliberate: a level's input is never overwritten.
  return directory;
}
