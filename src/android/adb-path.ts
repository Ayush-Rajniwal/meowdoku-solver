import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

interface AdbPathOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/** Explicit override, project tools, Android SDK, PATH, then legacy extracted Downloads. */
export function resolveAdbPath(options: AdbPathOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.ADB_PATH) return env.ADB_PATH;
  const root =
    options.root ?? fileURLToPath(new URL("../../", import.meta.url));
  const executable =
    (options.platform ?? process.platform) === "win32" ? "adb.exe" : "adb";
  const candidates = [
    join(root, ".tools", "platform-tools", executable),
    ...[env.ANDROID_HOME, env.ANDROID_SDK_ROOT]
      .filter((p): p is string => !!p)
      .map((p) => join(p, "platform-tools", executable)),
    ...(env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((p) => join(p, executable)),
    join(options.home ?? homedir(), "Downloads", "platform-tools", executable),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next known location. */
    }
  }
  return executable;
}
