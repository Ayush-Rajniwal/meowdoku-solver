import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseDevices, parseServices, validAddress } from "./adb-connection.ts";
import type { AdbCommand } from "./adb-connection.ts";

export interface PairedPhone {
  serial: string;
  address: string;
}
export interface PairingPrompts {
  question(prompt: string): Promise<string>;
  log(message: string): void;
  signal?: AbortSignal;
}
/** Terminal-independent pairing workflow. Codes are never stored or logged. */
export async function pairPhone(
  command: AdbCommand,
  connectionFile: string,
  prompts: PairingPrompts,
): Promise<PairedPhone | undefined> {
  async function ask(
    prompt: string,
    valid: (value: string) => boolean,
    error: string,
  ): Promise<string | undefined> {
    while (!prompts.signal?.aborted) {
      const value = (await prompts.question(prompt)).trim();
      if (!value) return undefined;
      if (valid(value)) return value;
      prompts.log(error);
    }
    return undefined;
  }
  prompts.log(
    "Open Wireless debugging → Pair device with pairing code. Keep that dialog open. Blank input cancels setup.",
  );
  while (!prompts.signal?.aborted) {
    const address = await ask(
      "Pairing IP:port: ",
      validAddress,
      "Enter the pairing address as IP:port, for example 192.0.2.10:43231.",
    );
    if (!address) return undefined;
    const code = await ask(
      "Six-digit pairing code: ",
      (value) => /^[0-9]{6}$/.test(value),
      "The pairing code must contain six digits.",
    );
    if (!code) return undefined;
    try {
      const output = command(["pair", address, code], 20000).toString();
      if (!/successfully paired/i.test(output))
        throw new Error("Pairing was not confirmed");
      break;
    } catch {
      // Never include a process error here: it could contain the one-time code.
      prompts.log(
        "Pairing failed. Open a fresh pairing-code dialog and enter its current address and code.",
      );
    }
  }
  if (prompts.signal?.aborted) return undefined;
  prompts.log(
    "Paired. Close the pairing-code dialog. Now read IP address & port on the main Wireless debugging screen; its port can be different.",
  );
  while (!prompts.signal?.aborted) {
    const address = await ask(
      "Connection IP:port (main screen): ",
      validAddress,
      "Enter the connection address as IP:port.",
    );
    if (!address) return undefined;
    try {
      command(["connect", address], 10000);
      let name: string | undefined;
      try {
        name = parseServices(
          command(["mdns", "services"], 4000).toString(),
        ).find((service) => service.address === address)?.name;
      } catch {
        /* Explicit connection can work without discovery. */
      }
      const device = parseDevices(
        command(["devices", "-l"], 4000).toString(),
      ).find(
        (device) =>
          device.state === "device" &&
          (device.serial === address ||
            (name &&
              device.serial.startsWith(name + "._adb-tls-connect._tcp"))),
      );
      if (!device) throw new Error("Not connected");
      mkdirSync(dirname(connectionFile), { recursive: true });
      // Replace the old pairing identity rather than carrying a forgotten GUID forward.
      writeFileSync(
        connectionFile,
        JSON.stringify(
          {
            serial: device.serial,
            address,
            ...(name ? { serviceName: name } : {}),
          },
          null,
          2,
        ) + "\n",
      );
      prompts.log("Phone connected. Return to the puzzle; the loop is ready.");
      return { serial: device.serial, address };
    } catch {
      prompts.log(
        "Connection failed. Check Wi-Fi and enter the connection port from the main Wireless debugging screen. Pairing does not need to be repeated here.",
      );
    }
  }
  return undefined;
}
