import { Box, Text, useInput } from "ink";
import {
  ConfirmInput,
  PasswordInput,
  ProgressBar,
  Spinner,
  StatusMessage,
  TextInput,
} from "@inkjs/ui";

export interface UiPrompt {
  id: number;
  label: string;
  kind: "text" | "password" | "confirm";
  submit(value: string): void;
}
export interface DashboardState {
  status:
    | "starting"
    | "working"
    | "waiting"
    | "ready"
    | "played"
    | "blocked"
    | "error"
    | "pairing"
    | "stopping";
  stage: string;
  message: string;
  connection: string;
  level: string;
  placed: number;
  total: number;
  queued: boolean;
  dryRun: boolean;
  autoAdvance?: boolean;
  watching?: boolean;
  prompt?: UiPrompt;
}
export interface UiActions {
  solve(): void;
  pair(): void;
  stop(): void;
}
export function Dashboard({
  state,
  actions,
}: {
  state: DashboardState;
  actions: UiActions;
}) {
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      actions.stop();
      return;
    }
    if (state.prompt) {
      if (key.escape) state.prompt.submit("");
      return;
    }
    if (key.ctrl || key.meta) return;
    if (input.toLowerCase() === "a") actions.solve();
    if (input.toLowerCase() === "p") actions.pair();
    if (input.toLowerCase() === "q") actions.stop();
  });
  const variant =
    state.status === "error"
      ? "error"
      : state.status === "played"
        ? "success"
        : state.status === "blocked"
          ? "warning"
          : "info";
  const busy = state.status === "working" || state.status === "starting";
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">
        Meowdoku Solver{state.dryRun ? " · DRY RUN" : ""}
      </Text>
      <Text>Connection: {state.connection}</Text>
      <Text>Level: {state.level || "Waiting for a board"}</Text>
      <Box marginTop={1}>
        {busy ? (
          <Spinner label={state.stage} />
        ) : (
          <Text bold>{state.stage}</Text>
        )}
      </Box>
      {state.total > 0 && (
        <Box flexDirection="column">
          <Text>
            Cats: {state.placed}/{state.total}
          </Text>
          <ProgressBar
            value={Math.min(100, (state.placed / state.total) * 100)}
          />
        </Box>
      )}
      <Box marginTop={1}>
        <StatusMessage variant={variant}>{state.message}</StatusMessage>
      </Box>
      {state.prompt && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{state.prompt.label}</Text>
          {state.prompt.kind === "confirm" ? (
            <ConfirmInput
              key={state.prompt.id}
              onConfirm={() => state.prompt!.submit("yes")}
              onCancel={() => state.prompt!.submit("no")}
            />
          ) : state.prompt.kind === "password" ? (
            <PasswordInput
              key={state.prompt.id}
              placeholder="Six digits"
              onSubmit={state.prompt.submit}
            />
          ) : (
            <TextInput
              key={state.prompt.id}
              placeholder="Enter value"
              onSubmit={state.prompt.submit}
            />
          )}
          <Text dimColor>Enter to submit · Esc to cancel · Ctrl+C to stop</Text>
        </Box>
      )}
      {!state.prompt && (
        <Box flexDirection="column" marginTop={1}>
          {state.watching && <Text>Watching for screen changes</Text>}
          {state.queued && (
            <Text color="yellow">One check queued after the current cycle</Text>
          )}
          <Text dimColor>a solve now · p pair phone · q / Ctrl+C stop</Text>
          <Text dimColor>
            {state.autoAdvance === false
              ? "Advance to the next puzzle on your phone."
              : "Auto advance enabled · unknown screens wait"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
