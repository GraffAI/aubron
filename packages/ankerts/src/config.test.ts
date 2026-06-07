import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigStore,
  findPrinter,
  mqttHostFor,
  mqttUsername,
  redactConfig,
  type AnkerConfig,
  type AnkerPrinter,
} from "./config.js";

const printer = (over: Partial<AnkerPrinter> = {}): AnkerPrinter => ({
  id: "1",
  sn: "SN123",
  name: "Tower",
  model: "M5",
  duid: "USPRAKM-000994-YYLLG",
  ip_addr: "",
  wifi_mac: "aa:bb",
  mqtt_key: "00112233445566778899aabbccddeeff",
  p2p_key: "secretp2p",
  api_hosts: ["make-app.ankermake.com"],
  p2p_hosts: ["p2p-mk.ankermake.com"],
  ...over,
});

const config: AnkerConfig = {
  account: {
    user_id: "u1",
    auth_token: "tok-abc",
    email: "a@b.com",
    region: "us",
  },
  printers: [printer(), printer({ id: "2", sn: "SN999", name: "Spare", duid: "X-000001-AAA" })],
};

describe("derived account fields", () => {
  it("derives mqtt username and broker host", () => {
    expect(mqttUsername(config.account!)).toBe("eufy_u1");
    expect(mqttHostFor(config.account!, config.printers[0]!)).toBe("make-mqtt.ankermake.com");
  });
});

describe("findPrinter", () => {
  it("resolves by index, duid, serial, and name", () => {
    expect(findPrinter(config, 0)?.sn).toBe("SN123");
    expect(findPrinter(config, "1")?.name).toBe("Spare"); // numeric string → index
    expect(findPrinter(config, "USPRAKM-000994-YYLLG")?.id).toBe("1");
    expect(findPrinter(config, "SN999")?.name).toBe("Spare");
    expect(findPrinter(config, "Tower")?.sn).toBe("SN123");
    expect(findPrinter(config, "nope")).toBeNull();
  });
});

describe("redactConfig", () => {
  it("masks auth token and crypto keys by default, reveals on demand", () => {
    const r = redactConfig(config);
    expect(r.account?.auth_token).toBe("<redacted>");
    expect(r.printers[0]?.mqtt_key).toBe("<redacted>");
    expect(r.printers[0]?.p2p_key).toBe("<redacted>");
    expect(redactConfig(config, true).account?.auth_token).toBe("tok-abc");
  });
});

describe("ConfigStore round-trip", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ankerts-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists and reloads, and updates printer IP", () => {
    const store = new ConfigStore(join(dir, "config.json"));
    expect(store.exists()).toBe(false);
    store.save(config);
    expect(store.exists()).toBe(true);
    expect(store.load().account?.user_id).toBe("u1");

    store.update((c) => {
      c.printers[0]!.ip_addr = "192.168.1.42";
    });
    expect(store.load().printers[0]?.ip_addr).toBe("192.168.1.42");
  });
});
