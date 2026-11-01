import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
export type AdbCommand = (args: string[], timeoutMs?: number) => Buffer;
interface Device {
  serial: string;
  state: string;
}
interface Service {
  name: string;
  address: string;
}
const savedConnectionSchema = z.object({
  serial: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  address: z
    .string()
    .refine(validAddress, "Invalid saved ADB address")
    .optional(),
});
type SavedConnection = z.infer<typeof savedConnectionSchema>;
export interface ConnectionOptions {
  serial?: string;
  address?: string;
  connectionFile?: string;
}
export function parseDevices(text: string): Device[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^(\S+)\s+(device|offline|unauthorized)\b/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ serial: match![1]!, state: match![2]! }));
}
export function validAddress(value: string): boolean {
  const match = /^(\[[0-9a-fA-F:%._-]+\]|[a-zA-Z0-9.-]+):([0-9]{1,5})$/.exec(
    value,
  );
  return !!match && Number(match[2]) > 0 && Number(match[2]) <= 65535;
}
export function parseServices(text: string): Service[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      /^(\S+)\s+_adb-tls-connect\._tcp\.?\s+(\S+)/.exec(line.trim()),
    )
    .filter((match) => match !== null && validAddress(match[2]!))
    .map((match) => ({ name: match![1]!, address: match![2]! }));
}
function serviceName(serial: string): string | undefined {
  return serial.includes("._adb-tls-connect._tcp")
    ? serial.split("._adb-tls-connect._tcp")[0]
    : undefined;
}
/** Selects one phone and reconnects reads through discovery or a remembered address. */
export function createConnection(
  command: AdbCommand,
  options: ConnectionOptions = {},
) {
  let saved: SavedConnection = {};
  if (options.connectionFile && existsSync(options.connectionFile)) {
    saved = savedConnectionSchema.parse(
      JSON.parse(readFileSync(options.connectionFile, "utf8")),
    );
  }
  if (options.serial)
    saved = {
      ...saved,
      serial: options.serial,
      serviceName: serviceName(options.serial),
    };
  if (options.address) {
    if (!validAddress(options.address))
      throw new Error("ADB_ADDRESS must be an IP address and connection port");
    saved.address = options.address;
  }
  let target: string | undefined;
  function remember(serial: string, service?: Service): string {
    target = serial;
    const name = service?.name ?? serviceName(serial) ?? saved.serviceName;
    if (!service && !saved.address && name) {
      try {
        service = parseServices(
          command(["mdns", "services"], 4000).toString(),
        ).find((item) => item.name === name);
      } catch {
        /* Discovery may be unavailable; keep the known serial. */
      }
    }
    saved = {
      ...saved,
      serial,
      serviceName: service?.name ?? serviceName(serial) ?? saved.serviceName,
      address:
        service?.address ?? (validAddress(serial) ? serial : saved.address),
    };
    if (options.connectionFile) {
      mkdirSync(dirname(options.connectionFile), { recursive: true });
      writeFileSync(
        options.connectionFile,
        JSON.stringify(saved, null, 2) + "\n",
      );
    }
    return serial;
  }
  function ensure(): string {
    const devices = parseDevices(command(["devices", "-l"], 4000).toString());
    const ready = devices.filter((device) => device.state === "device");
    const known = ready.find(
      (device) =>
        device.serial === saved.serial ||
        device.serial === saved.address ||
        (saved.serviceName && serviceName(device.serial) === saved.serviceName),
    );
    if (known) return remember(known.serial);
    const pinned = !!(saved.serial || saved.serviceName || saved.address);
    if (!pinned && ready.length === 1) return remember(ready[0]!.serial);
    if (!pinned && ready.length > 1)
      throw new Error(
        "Multiple phones connected. Set ANDROID_SERIAL to choose yours.",
      );
    let services: Service[] = [];
    try {
      services = parseServices(command(["mdns", "services"], 4000).toString());
    } catch {
      /* Remembered address may still work. */
    }
    let discovered = services.find(
      (service) =>
        service.name === saved.serviceName ||
        service.address === saved.address ||
        service.name === options.serial ||
        service.address === options.serial,
    );
    if (!pinned && services.length === 1) discovered = services[0];
    if (!pinned && services.length > 1)
      throw new Error(
        "Multiple wireless phones discovered. Set ANDROID_SERIAL to choose yours.",
      );
    const addresses = [
      ...new Set(
        [
          discovered?.address,
          saved.address,
          options.serial && validAddress(options.serial)
            ? options.serial
            : undefined,
        ].filter((value): value is string => !!value),
      ),
    ];
    for (const address of addresses) {
      try {
        command(["connect", address], 4000);
        const connected = parseDevices(
          command(["devices", "-l"], 4000).toString(),
        ).find(
          (device) =>
            device.state === "device" &&
            (device.serial === address ||
              device.serial === saved.serial ||
              (saved.serviceName &&
                serviceName(device.serial) === saved.serviceName) ||
              (discovered && serviceName(device.serial) === discovered.name)),
        );
        if (connected)
          return remember(
            connected.serial,
            discovered?.address === address ? discovered : undefined,
          );
      } catch {
        /* Try the other known address without replaying any taps. */
      }
    }
    throw new Error(
      "Phone disconnected. Turn on Wi-Fi and Wireless debugging, then press a to reconnect. Press p for pairing setup, or set ADB_ADDRESS to the connection IP:port.",
    );
  }
  return { ensure, target: () => target ?? ensure() };
}
