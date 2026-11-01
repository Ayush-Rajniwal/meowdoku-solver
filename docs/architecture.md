# How Meowdoku Solver works

[Back to the README](../README.md)

The application turns pixels into a board, solves that board, and turns the result into Android input. Each stage has a separate responsibility. The constraint solver can run without an Android device, OCR, or a terminal.

## 1. Capture and detect the board

ADB captures the currently visible display as a PNG. `vision/image.ts` decodes it with [pngjs](https://github.com/pngjs/pngjs).

`vision/grid.ts` finds connected colored components whose bounds look like square cells. It looks for exactly one complete, evenly spaced square lattice. Missing cells, multiple plausible boards, and non-grid screens are rejected; the parser does not infer missing cells.

The screenshot determines the board size and the center of every cell. Tap coordinates are calculated from those centers, so the solver is not tied to a single screenshot resolution. Tests include half-resolution screenshots and generated grids of different sizes. The game's layout, gutters, colors, and artwork still matter.

## 2. Read regions and marks

`vision/background.ts` samples four outer corner patches of each cell, away from the cat or cross in the center. It finds a dominant background color and requires sufficient agreement. Similar colors receive the same region ID, including disconnected cells of one color.

`vision/marks.ts` examines the cell interior. Cats are recognized from dark fur plus white face/eye pixels. White crosses are recorded separately. Unrecognized content and partial marks are rejected rather than silently treated as empty.

The resulting puzzle contains:

- A square `regions` matrix.
- `fixedCats` detected in the image.
- Grid geometry and cell centers used to prepare taps.

Crosses are user annotations. They do not become `blockedCells`, and a solution cat can be placed over an X. Existing cats do constrain the solution and are omitted from the tap plan.

This is a game-specific parser, not a general vision model. A floating system handle can obscure its corner samples even when the board appears readable to a person.

## 3. Identify the level

`vision/level-header.ts` uses [Tesseract.js](https://github.com/naptha/tesseract.js) to read the header. It checks both the normal Level block and its shifted position on Hard levels. Numbered puzzles get names such as `level-140`; unnamed score headers produce local `golden-fish-NNN` sequences.

The OCR engine and English language data are npm dependencies and run locally. There are no LLM calls or OCR downloads during play. Shared worker setup silences native numeric diagnostics so they do not overwrite the terminal UI.

## 4. Solve the constraints

On an N × N board with N regions:

- Each row contains exactly one cat.
- Each column contains exactly one cat.
- Each color contains exactly one cat.
- Cats cannot touch, including diagonally.

`solver/board.ts` validates inputs. `placement-rules.ts` checks legal placements. `search.ts` uses backtracking, choosing the row with the fewest legal cells (minimum remaining values) and rejecting branches where any row has no candidate (forward checking).

Worst-case search is exponential, with up to N! column assignments. The implementation targets puzzle-sized boards. Execution requires one solution with an exhaustive search result proving uniqueness, not simply the first solution found.

The independent API accepts `regions`, optional `fixedCats`, and optional `blockedCells`, with zero-based coordinates. Region IDs can be nonempty strings or finite numbers; there must be exactly N distinct IDs. Invalid inputs throw; contradictory cats produce no solution. `maxSolutions` defaults to two; `Infinity` requests all solutions. `exhaustive` indicates whether enumeration finished.

## 5. Prepare and execute

`levels/play-plan.ts` maps the unique solution to cell centers and removes existing cats. `level-artifacts.ts` writes:

- `input.png`: the captured board.
- `output.json`: the validated tap plan, image dimensions, and input hash.
- `preview.png`: blue detected cells, green planned cats, yellow existing cats.
- `analysis/`: parsed puzzle, geometry, and solver output.

`level-runner.ts` validates the saved input hash and plan. `android/cat-player.ts` sends two taps per target, then waits 700 ms between cats. The runner updates `execution.json` after each placement and tries to save `final.png`, including after a tap failure.

The input hash binds a saved plan to its input file. It does not verify that the phone still displays that board. The standalone executor must be used with the matching puzzle visible.

Physical taps are never automatically replayed after a lost response: the phone may already have received them. A completed execution is a no-op on repeat; failed/interrupted attempts require inspection. The automated board workflow also recognizes previously played layouts independently of crosses, cats, or arbitrary color labels.

## 6. Advance and watch

`navigation/reader.ts` recognizes the observed game score header and a small set of continuation controls: leaderboard “Tap to Continue,” milestone “Continue,” “Level N,” and “Golden Fish.” Orange primary buttons are located using pixels and their text is checked with local OCR.

Two captures must agree on the control and its coordinates before a single tap is sent. Each chain is limited to six transitions. A persisted marker prevents replay if a button remains visible or a response is lost. The marker clears when the completion overlay has gone. Unknown screens and ads receive no guessed taps. Golden Fish is preferred over its secondary Skip link.

Before/after navigation screenshots and `actions.jsonl` are saved under the level's `advancement/` folder, or `runtime/navigation/` for a completion screen encountered before a level is identified. `final.png` remains the immediate post-placement capture.

`automation/watch-screen.ts` samples the screen approximately once a second and hashes the PNG. A changed frame triggers the workflow. Unchanged frames skip OCR and solving; transient waiting states and connection errors retry after five seconds. A finished solve triggers another check without a minute-long pause. Workflow calls never overlap.

A process lock prevents simultaneous controllers. The `a` shortcut coalesces repeated requests into one queued check. Pairing requests wait until the current workflow finishes. Graceful exit stops work and removes disposable runtime PNGs while still holding the lock.

## Module map

| Folder             | Responsibility                                                          |
| ------------------ | ----------------------------------------------------------------------- |
| `src/solver/`      | Puzzle types, validation, legality, search, board identity              |
| `src/vision/`      | Image decoding, grids, colors, marks, previews, header OCR              |
| `src/android/`     | ADB discovery, transport, pairing, tap sequencing                       |
| `src/levels/`      | Folder allocation, plans, artifacts, execution records                  |
| `src/navigation/`  | Completion-screen recognition and guarded input                         |
| `src/automation/`  | Board workflow, advancement coordination, watching, scheduling, locking |
| `src/ui/`          | Ink dashboard, shortcuts, pairing fields                                |
| `src/cli/`         | Commands, startup wiring, shutdown                                      |
| `src/maintenance/` | Runtime screenshot cleanup                                              |

The UI uses Ink and `@inkjs/ui`; commands use Commander. Zod validates stored tap-plan and connection JSON. Small scheduling and lock helpers remain local because they encode application-specific behavior.

## Validation and limits

Regression images live in `tests/fixtures/`, separate from ignored gameplay history. Tests compare complete region maps against manually labeled boards, distinguish cats from crosses, and check uncertain/animated/obscured screens. Generated boards cover several sizes; a separate brute-force permutation oracle checks the solver on 120 seeded cases.

Fake devices and clocks test tap sequencing, cancellation, reconnection, repeat prevention, navigation, cleanup, and screen watching. UI tests render the real components and send keyboard events. Installer tests use local archives and stub tools; an isolated real macOS bootstrap has also been verified.

The parser and continuation recognizer have been tested against one game's artwork and one phone. General ad handling and universal win recognition are not implemented. A successful placement record is not itself proof of an accepted game win.
