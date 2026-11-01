# Development and setup details

[Back to the README](../README.md) · [Architecture](architecture.md) · [Troubleshooting](troubleshooting.md)

## Platform requirements

The bootstrap scripts require Bash and support macOS and Linux on Intel/x86_64 or ARM64. Downloads need `curl`, `tar`, `gzip`, `unzip`, and `shasum` or `sha256sum`. Basic filesystem tools must also be available. Official Node binaries must be compatible with the host OS/libc.

- **macOS:** a full Apple Silicon bootstrap has been tested. Intel binaries are selected by architecture but have not been tested on Intel hardware.
- **Linux x86_64:** installation is supported by the scripts; Linux hardware has not yet been verified.
- **Linux ARM64:** install a native ADB with your distribution's package manager before setup. Google's Linux platform-tools archive is x86_64.
- **Windows:** the Bash bootstrap is not a Windows installer. Install Node 24+ and [Android Platform-Tools](https://developer.android.com/tools/releases/platform-tools) manually, add ADB to `PATH` or set `ADB_PATH`, then run `npm ci` and `npm start`. Windows has not been tested. USB may require an [OEM driver](https://developer.android.com/studio/run/oem-usb).

Node 24+ with npm is reused when present. Otherwise setup downloads a matching Node 24 archive from the [official distribution server](https://nodejs.org/dist/), verifies its SHA-256 hash, and installs it into `.tools/node`. ADB is reused from configured/standard paths or downloaded from Google's [official Platform-Tools links](https://developer.android.com/tools/releases/platform-tools). Its ZIP is tested for integrity before installation. `adb version` verifies the executable without connecting to the phone.

`npm ci --include=dev` installs packages from the lockfile, followed by type checking. No global packages, shell profiles, or system power settings are modified. Setup refuses dependency replacement while the controller holds a live process lock. `--check` only inspects prerequisites.

## Checks

From the project root:

```sh
./setup.sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm test
npm run typecheck
npm run format:check
```

Use `npm run format` to apply formatting. Installer fixture tests use `zip` to construct test archives; that extra utility is needed for the development test suite, not ordinary play.

## Work with a saved board

The normal workflow is `./run.sh`. These commands are for debugging or deliberate recovery, with the controller stopped.

Capture a new folder without tapping:

```sh
npm run capture -- level-001
# For an unnamed bonus puzzle, allocate the next local ID:
npm run capture -- golden-fish
```

Folders are not overwritten. You can also create a folder and supply your own `input.png`.

Parse and solve that screenshot:

```sh
npm run prepare-level -- levels/level-001
```

This writes `output.json`, `preview.png`, and `analysis/`. It detects the grid and coordinates automatically and requires a proven unique solution. The command is named `prepare-level` because `prepare` is an npm installation lifecycle hook.

Preview the saved tap plan, then execute it with the **matching board still visible**:

```sh
npm run run-level -- levels/level-001
npm run run-level -- levels/level-001 --execute
```

The executor consumes saved coordinates; it does not parse again or verify that the current phone screen matches. It checks that the input file still matches the plan's hash, records placements, and saves `final.png`. Existing cats are omitted. Failed/interrupted records are preserved; a repeat successful execution is a no-op.

To recover an interrupted game deliberately, inspect the old attempt and capture the current board under a new name, such as `level-001-recovery`, then prepare and preview that new folder. Never reuse old screen coordinates after the phone changes puzzle.

Solve a regression board as JSON without a phone:

```sh
npm run solve -- tests/fixtures/levels/level-077/reference.json all
```

## Environment variables

| Variable                            | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `ADB_PATH`                          | Explicit ADB executable path or command       |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | Android SDK roots searched for platform-tools |
| `ANDROID_SERIAL`                    | Choose a specific connected phone             |
| `ADB_ADDRESS`                       | Current wireless connection IP:port           |

The application also discovers `.tools/platform-tools/adb`, `adb` on `PATH`, and a legacy manually extracted `Downloads/platform-tools` installation. `run.sh` prepends project-local Node and ADB directories for its own process only.

## Cleanup

Graceful controller shutdown (`q`, Ctrl+C, SIGTERM, or normal `--once` completion) deletes PNGs directly under `runtime/` and `runtime/navigation/`. It preserves all level history, connection settings, replay guards, and audit logs. Cleanup runs under the controller lock, which is released even if cleanup fails. Force-killing or losing power cannot run shutdown cleanup.

For leftovers, preview screenshots older than seven days:

```sh
npm run cleanup
```

Preview every disposable runtime screenshot, or delete that category after stopping the controller:

```sh
npm run cleanup -- --older-than-days 0
npm run cleanup -- --older-than-days 0 --execute
```

The standalone command previews by default and refuses deletion while the controller is running. It does not follow symlinks or access the phone. Downloaded `.tools/` and `node_modules/` are not part of screenshot cleanup.

## Documentation images

The README uses static files in `docs/images/` so it does not depend on a live device or an external image host. The game image is a captured regression board. The terminal image is rendered from the real Ink `Dashboard` component using demonstration values; it does not contain a device IP, pairing code, or personal terminal content.

The screenshots illustrate the project. Meowdoku game artwork belongs to its respective owners; the project is unofficial and does not bundle the game itself.
