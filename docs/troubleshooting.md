# Troubleshooting

[Back to the README](../README.md)

## The phone will not connect

Check that the phone and computer are on the same Wi-Fi network and Wireless debugging is enabled. School, guest, and corporate networks may block device discovery or connections. Google's [wireless ADB guide](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi) explains platform setup and common networking issues.

Use `./run.sh --pair` for first-time setup, or **p** in the running terminal if the phone forgot the computer. Keep the pairing-code dialog open until pairing succeeds. Then close it and use the connection IP:port from the main Wireless debugging screen.

The two ports can differ. A new pairing code is usually unnecessary after a Wi-Fi interruption unless the phone no longer trusts the computer.

The controller remembers the device in `runtime/connection.json` and tries discovery and the remembered endpoint. If the connection port changed and discovery fails, stop the controller and supply the current connection address:

```sh
ADB_ADDRESS=192.168.1.50:40000 ./run.sh
```

Replace that example with your phone's actual address. **a** forces a check while the controller runs. Multiple unknown devices are not selected automatically; use `ANDROID_SERIAL` to choose one.

## “Cell corners are obscured or animated”

The parser cannot confidently read a cell's background color. Wait for game animations or toasts to disappear. Move floating overlays, accessibility controls, and Edge panel handles away from the board. Keep the complete board visible.

The watcher should retry when the image changes. Press **a** for an immediate check. Restarting alone will not fix an overlay that stays over the same pixels.

If it persists on a clean, settled board, inspect `runtime/latest-screen.png` before quitting, because graceful exit deletes temporary runtime screenshots. That image can help reproduce a parser issue. It captures the whole display, so review it before sharing.

## The game is solved but does not advance

Known continuation buttons are handled automatically. Ads, unfamiliar screens, touch-protection locks, or incomplete button animations can cause waiting. Check that `--no-auto-advance` was not used. Manually handle unsupported screens; the watcher can then resume on a readable board.

If the controller says the last continuation control remains visible, it is avoiding a duplicate tap. Inspect the screen and the saved navigation evidence before continuing manually.

## The laptop sleeps and play pauses

Sleep suspends the process and can break wireless ADB. On macOS, prevent idle sleep while it runs:

```sh
caffeinate -i ./run.sh
```

The display may turn off. Closing the lid or manually sleeping the laptop can still interrupt it. This is separate from the controller's safeguards against replaying uncertain taps.

## “Previous attempt needs inspection”

A previous placement attempt failed or stopped partway through. The controller keeps its execution record and avoids blindly replaying taps. Inspect that level's `final.png`, `output.json`, and `execution.json`.

To continue deliberately, stop the controller, keep the actual current puzzle visible, and use a fresh folder for the manual workflow. Existing cats will be included as constraints and omitted from the new tap plan. See [saved-board commands](development.md#work-with-a-saved-board). Do not delete the old execution record just to bypass the guard.

## Setup or launch fails

Run:

```sh
./setup.sh --check
```

Stop an active controller before `./setup.sh` installs packages. Install any missing basic utility listed in the error with your OS package manager. Unsupported architectures or Linux distributions may need manually installed Node/ADB; see [platform requirements](development.md#platform-requirements).

If setup installed Node locally, use `./run.sh`. Other npm commands need that Node on the current terminal's `PATH`:

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
```

`ADB_PATH` overrides discovery. Otherwise the application checks project tools, Android SDK paths, `PATH`, and a legacy manually extracted Downloads location. Restart after source changes; an existing process keeps its loaded code.
