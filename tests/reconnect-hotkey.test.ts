import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { ManualTrigger } from "../src/automation/manual-trigger.ts";
import {
  createConnection,
  parseDevices,
  parseServices,
} from "../src/android/adb-connection.ts";
import { createAdbDevice } from "../src/android/adb-device.ts";
import { poll } from "../src/automation/polling-loop.ts";
const buffer = (text: string) => Buffer.from(text);
function file(t: TestContext, value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "adb-reconnect-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "connection.json");
  writeFileSync(filename, JSON.stringify(value));
  return filename;
}
test("pressing a wakes the minute wait immediately, without Enter", async () => {
  const trigger = new ManualTrigger(),
    signal = new AbortController().signal;
  const waiting = trigger.wait(60_000, signal);
  trigger.request();
  await waiting;
});
test("many keypresses during a cycle queue only one extra check", async () => {
  const trigger = new ManualTrigger();
  for (let i = 0; i < 10; i++) trigger.request();
  await trigger.wait(60_000, new AbortController().signal);
  const controller = new AbortController();
  let resolved = false;
  const next = trigger.wait(60_000, controller.signal).then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  controller.abort();
  await next;
});
test("manual request runs a queued cycle serially, then shutdown clears the timer", async () => {
  const trigger = new ManualTrigger(),
    controller = new AbortController();
  let calls = 0,
    active = false;
  await poll({
    intervalMs: 60_000,
    signal: controller.signal,
    async cycle() {
      assert.equal(active, false);
      active = true;
      calls++;
      if (calls === 1) {
        trigger.request();
        trigger.request();
      } else controller.abort();
      await Promise.resolve();
      active = false;
    },
    wait: (ms, signal) => trigger.wait(ms, signal),
  });
  assert.equal(calls, 2);
});
test("ADB parsers recognize ready/offline devices and ignore pairing announcements", () => {
  assert.deepEqual(
    parseDevices(
      "List of devices attached\nabc device product:x\nxyz offline\nauth unauthorized\n",
    ),
    [
      { serial: "abc", state: "device" },
      { serial: "xyz", state: "offline" },
      { serial: "auth", state: "unauthorized" },
    ],
  );
  assert.deepEqual(
    parseServices(
      "List of discovered mdns services\nphone _adb-tls-connect._tcp 192.0.2.10:45678\nphone _adb-tls-pairing._tcp 192.0.2.10:12345\n",
    ),
    [{ name: "phone", address: "192.0.2.10:45678" }],
  );
});
test("a single already-connected phone is selected and remembered", (t) => {
  const filename = file(t, {});
  const connection = createConnection(
    (args) => {
      assert.deepEqual(args, ["devices", "-l"]);
      return buffer("List of devices attached\nphone device\n");
    },
    { connectionFile: filename },
  );
  assert.equal(connection.ensure(), "phone");
  assert.equal(JSON.parse(readFileSync(filename, "utf8")).serial, "phone");
});
test("wireless discovery reconnects to the advertised connection port", () => {
  let connected = false;
  const calls: string[][] = [];
  const connection = createConnection((args) => {
    calls.push(args);
    if (args[0] === "devices")
      return buffer(
        connected ? "192.0.2.10:45678 device\n" : "List of devices attached\n",
      );
    if (args[0] === "mdns")
      return buffer(
        "phone _adb-tls-connect._tcp 192.0.2.10:45678\nphone _adb-tls-pairing._tcp 192.0.2.10:12345\n",
      );
    if (args[0] === "connect") {
      assert.equal(args[1], "192.0.2.10:45678");
      connected = true;
      return buffer("connected");
    }
    assert.fail("Unexpected command");
  });
  assert.equal(connection.ensure(), "192.0.2.10:45678");
  assert.equal(calls.filter((args) => args[0] === "connect").length, 1);
});
test("a changed Wi-Fi connection port is discovered using the saved service identity", (t) => {
  const filename = file(t, {
    serial: "192.0.2.10:11111",
    address: "192.0.2.10:11111",
    serviceName: "phone",
  });
  let connected = false;
  const connection = createConnection(
    (args) => {
      if (args[0] === "devices")
        return buffer(connected ? "192.0.2.10:22222 device\n" : "");
      if (args[0] === "mdns")
        return buffer(
          "phone _adb-tls-connect._tcp 192.0.2.10:22222\nother _adb-tls-connect._tcp 192.0.2.11:33333\n",
        );
      if (args[0] === "connect") {
        assert.equal(args[1], "192.0.2.10:22222");
        connected = true;
        return buffer("connected");
      }
      assert.fail();
    },
    { connectionFile: filename },
  );
  assert.equal(connection.ensure(), "192.0.2.10:22222");
  assert.equal(
    JSON.parse(readFileSync(filename, "utf8")).address,
    "192.0.2.10:22222",
  );
});
test("the saved address can reconnect when discovery is unavailable", (t) => {
  const filename = file(t, {
    serial: "192.0.2.10:45678",
    address: "192.0.2.10:45678",
  });
  let connected = false;
  const connection = createConnection(
    (args) => {
      if (args[0] === "devices")
        return buffer(connected ? "192.0.2.10:45678 device\n" : "");
      if (args[0] === "mdns") return buffer("");
      if (args[0] === "connect") {
        connected = true;
        return buffer("connected");
      }
      assert.fail();
    },
    { connectionFile: filename },
  );
  assert.equal(connection.ensure(), "192.0.2.10:45678");
});
test("missing Wi-Fi produces one actionable error, without retrying physical taps", () => {
  let commands = 0;
  const connection = createConnection(() => {
    commands++;
    return buffer("");
  });
  assert.throws(() => connection.ensure(), /Phone disconnected.*Wi-Fi/);
  assert.equal(commands, 2);
});
test("multiple devices require an explicit target", () => {
  const connection = createConnection(() => buffer("one device\ntwo device\n"));
  assert.throws(() => connection.ensure(), /Multiple phones/);
});
test("a remembered phone is not replaced by an unrelated connected phone", (t) => {
  const connection = createConnection(
    (args) => buffer(args[0] === "devices" ? "other device\n" : ""),
    { connectionFile: file(t, { serial: "my-phone" }) },
  );
  assert.throws(() => connection.ensure(), /Phone disconnected/);
});
test("a lost screenshot response may reconnect and retry the read once", () => {
  let reads = 0;
  const device = createAdbDevice("unused", undefined, {
    command: (args) => {
      if (args[0] === "devices") return buffer("phone device\n");
      if (args.includes("screencap")) {
        if (++reads === 1) throw new Error("device offline");
        return buffer("PNG bytes");
      }
      assert.fail("Unexpected command");
    },
  });
  assert.equal(device.screenshot().toString(), "PNG bytes");
  assert.equal(reads, 2);
});
test("a failed physical tap is sent only once and is never automatically retried", async () => {
  let taps = 0;
  const device = createAdbDevice("unused", undefined, {
    command: (args) => {
      if (args[0] === "devices") return buffer("phone device\n");
      if (args.includes("screencap")) return buffer("PNG bytes");
      if (args.includes("tap")) {
        taps++;
        throw new Error("device offline");
      }
      assert.fail();
    },
  });
  device.screenshot();
  await assert.rejects(device.tap(100, 200), /offline/);
  assert.equal(taps, 1);
});

test("an already-connected mDNS phone saves its connection address for a later Wi-Fi drop", (t) => {
  const filename = file(t, {});
  let online = true,
    advertising = true;
  const serial = "phone._adb-tls-connect._tcp";
  const connection = createConnection(
    (args) => {
      if (args[0] === "devices")
        return buffer(online ? serial + " device\n" : "");
      if (args[0] === "mdns")
        return buffer(
          advertising ? "phone _adb-tls-connect._tcp 192.0.2.10:45678\n" : "",
        );
      if (args[0] === "connect") {
        assert.equal(args[1], "192.0.2.10:45678");
        online = true;
        return buffer("connected");
      }
      assert.fail();
    },
    { connectionFile: filename },
  );
  assert.equal(connection.ensure(), serial);
  assert.equal(
    JSON.parse(readFileSync(filename, "utf8")).address,
    "192.0.2.10:45678",
  );
  online = false;
  advertising = false;
  assert.equal(connection.ensure(), serial);
});
