import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { pairPhone } from "../src/android/pair-phone.ts";
import type { AdbCommand } from "../src/android/adb-connection.ts";
function destination(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "phone-pairing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, "connection.json");
}
function prompts(answers: string[]) {
  const questions: string[] = [],
    logs: string[] = [];
  return {
    questions,
    logs,
    question: async (prompt: string) => {
      questions.push(prompt);
      const answer = answers.shift();
      assert.notEqual(answer, undefined, "Unexpected prompt");
      return answer!;
    },
    log: (message: string) => {
      logs.push(message);
    },
  };
}
function working(calls: string[][]): AdbCommand {
  return (args) => {
    calls.push(args);
    if (args[0] === "pair")
      return Buffer.from("Successfully paired to 192.0.2.10:11111");
    if (args[0] === "connect") return Buffer.from("connected");
    if (args[0] === "mdns")
      return Buffer.from("new-phone _adb-tls-connect._tcp 192.0.2.10:22222\n");
    if (args[0] === "devices")
      return Buffer.from("new-phone._adb-tls-connect._tcp device\n");
    assert.fail("Unexpected command");
  };
}
test("pairing asks for both ports, preserves leading-zero code, and replaces forgotten identity", async (t) => {
  const file = destination(t);
  writeFileSync(
    file,
    JSON.stringify({
      serial: "old-phone",
      serviceName: "old-guid",
      address: "old:12345",
    }),
  );
  const calls: string[][] = [],
    ui = prompts(["192.0.2.10:11111", "001234", "192.0.2.10:22222"]);
  const result = await pairPhone(working(calls), file, ui);
  assert.deepEqual(result, {
    serial: "new-phone._adb-tls-connect._tcp",
    address: "192.0.2.10:22222",
  });
  assert.deepEqual(calls[0], ["pair", "192.0.2.10:11111", "001234"]);
  assert.deepEqual(calls[1], ["connect", "192.0.2.10:22222"]);
  const saved = readFileSync(file, "utf8");
  assert.deepEqual(JSON.parse(saved), {
    serial: "new-phone._adb-tls-connect._tcp",
    address: "192.0.2.10:22222",
    serviceName: "new-phone",
  });
  assert.ok(!saved.includes("001234"));
  assert.ok(!ui.logs.join("\n").includes("001234"));
  assert.equal(ui.questions.length, 3);
});
test("invalid addresses and non-six-digit codes are rejected before ADB pairing", async (t) => {
  const calls: string[][] = [],
    ui = prompts([
      "192.0.2.10",
      "192.0.2.10:99999",
      "192.0.2.10:11111",
      "12345",
      "abcdef",
      "654321",
      "192.0.2.10:22222",
    ]);
  await pairPhone(working(calls), destination(t), ui);
  assert.equal(calls.filter((args) => args[0] === "pair").length, 1);
  assert.deepEqual(calls[0], ["pair", "192.0.2.10:11111", "654321"]);
});
test("failed pairing requests a fresh code without exposing the old one", async (t) => {
  const calls: string[][] = [],
    base = working(calls);
  let pairs = 0;
  const ui = prompts([
    "192.0.2.10:11111",
    "123456",
    "192.0.2.10:11112",
    "654321",
    "192.0.2.10:22222",
  ]);
  await pairPhone(
    (args) => {
      if (args[0] === "pair" && ++pairs === 1)
        throw new Error("Command failed: adb pair 192.0.2.10:11111 123456");
      return base(args);
    },
    destination(t),
    ui,
  );
  assert.equal(pairs, 2);
  assert.ok(!ui.logs.join("\n").includes("123456"));
  assert.match(ui.logs.join("\n"), /fresh pairing-code dialog/);
});
test("connection failure asks for the connection port again without repeating pairing", async (t) => {
  const calls: string[][] = [],
    base = working(calls),
    ui = prompts([
      "192.0.2.10:11111",
      "123456",
      "192.0.2.10:33333",
      "192.0.2.10:22222",
    ]);
  await pairPhone(
    (args) => {
      if (args[0] === "connect" && args[1] === "192.0.2.10:33333")
        throw new Error("Wrong port");
      return base(args);
    },
    destination(t),
    ui,
  );
  assert.equal(calls.filter((args) => args[0] === "pair").length, 1);
  assert.match(ui.logs.join("\n"), /Connection failed/);
});
test("blank pairing input cancels without commands or changing saved configuration", async (t) => {
  const file = destination(t);
  writeFileSync(file, '{"serial":"existing"}');
  const ui = prompts([""]);
  assert.equal(
    await pairPhone(
      () => {
        assert.fail("No ADB command expected");
      },
      file,
      ui,
    ),
    undefined,
  );
  assert.equal(readFileSync(file, "utf8"), '{"serial":"existing"}');
});
test("an already-aborted setup sends no commands and saves no code or connection", async (t) => {
  const file = destination(t),
    controller = new AbortController();
  controller.abort();
  const result = await pairPhone(
    () => {
      assert.fail();
    },
    file,
    {
      signal: controller.signal,
      question: async () => {
        assert.fail();
      },
      log: () => {},
    },
  );
  assert.equal(result, undefined);
  assert.equal(existsSync(file), false);
});
test("a different connected device cannot falsely confirm the requested connection", async (t) => {
  const file = destination(t),
    ui = prompts(["192.0.2.10:11111", "123456", "192.0.2.10:22222", ""]);
  const result = await pairPhone(
    (args) => {
      if (args[0] === "pair") return Buffer.from("Successfully paired");
      if (args[0] === "connect") return Buffer.from("connected");
      if (args[0] === "mdns") return Buffer.from("");
      return Buffer.from("unrelated-phone device\n");
    },
    file,
    ui,
  );
  assert.equal(result, undefined);
  assert.equal(existsSync(file), false);
});
