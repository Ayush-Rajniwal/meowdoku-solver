import { render } from "ink";
import type { Instance } from "ink";
import { Dashboard } from "./dashboard.tsx";
import type { DashboardState, UiActions, UiPrompt } from "./dashboard.tsx";

export interface TerminalUi {
  update(patch: Partial<DashboardState>): void;
  note(message: string): void;
  question(
    label: string,
    options?: { secret?: boolean; signal?: AbortSignal },
  ): Promise<string>;
  confirm(label: string, signal?: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}
/** Adapts application events and prompt promises to Ink components. */
export function createTerminalUi(
  actions: UiActions,
  options: { interactive: boolean; dryRun: boolean; autoAdvance?: boolean },
): TerminalUi {
  let state: DashboardState = {
    status: "starting",
    stage: "Starting",
    message: "Preparing the solver",
    connection: "Checking",
    level: "",
    placed: 0,
    total: 0,
    queued: false,
    dryRun: options.dryRun,
    autoAdvance: options.autoAdvance,
  };
  let instance: Instance | undefined;
  let lastMessage = "",
    promptId = 0,
    closed = false;
  const redraw = () => {
    if (instance)
      instance.rerender(<Dashboard state={state} actions={actions} />);
    else if (!options.interactive && state.message !== lastMessage) {
      console.log("[" + new Date().toLocaleTimeString() + "] " + state.message);
      lastMessage = state.message;
    }
  };
  const update = (patch: Partial<DashboardState>) => {
    state = { ...state, ...patch };
    redraw();
  };
  if (options.interactive) {
    instance = render(<Dashboard state={state} actions={actions} />, {
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 20,
    });
    void instance.waitUntilExit().then(
      () => {
        if (!closed) actions.stop();
      },
      () => actions.stop(),
    );
  }
  async function ask(
    label: string,
    kind: UiPrompt["kind"],
    signal?: AbortSignal,
  ): Promise<string> {
    if (!options.interactive)
      throw new Error(
        "Pairing requires an interactive terminal. Restart without --no-tui.",
      );
    if (signal?.aborted) return "";
    if (state.prompt) throw new Error("A pairing field is already active");
    return new Promise((resolve) => {
      const id = ++promptId;
      const finish = (value: string) => {
        if (state.prompt?.id !== id) return;
        signal?.removeEventListener("abort", abort);
        update({ prompt: undefined });
        resolve(value);
      };
      const abort = () => finish("");
      update({ prompt: { id, label, kind, submit: finish } });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  return {
    update,
    note: (message) => update({ message }),
    question: (label, settings) =>
      ask(label, settings?.secret ? "password" : "text", settings?.signal),
    confirm: async (label, signal) =>
      (await ask(label, "confirm", signal)) === "yes",
    async close() {
      if (closed) return;
      closed = true;
      state.prompt?.submit("");
      instance?.unmount();
      await instance?.waitUntilExit();
    },
  };
}
