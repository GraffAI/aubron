/**
 * Stored configuration — the SDK's source of truth (brief §8).
 *
 * Holds the account auth material and the per-printer records (crypto keys,
 * hostnames, and the discovered LAN IP). Persisted as JSON under an
 * OS-appropriate config directory. Secrets are redactable for `config show`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export type Region = "us" | "eu";

export interface AnkerAccount {
  user_id: string;
  auth_token: string;
  email: string;
  region: Region;
  country?: string;
}

export interface AnkerPrinter {
  id: string;
  sn: string;
  name: string;
  model: string;
  /** PPPP device id (`p2p_did`), e.g. `USPRAKM-000994-YYLLG`. */
  duid: string;
  /** LAN IP — populated by discovery, not login. Empty until discovered. */
  ip_addr: string;
  wifi_mac: string;
  /** Per-printer MQTT AES key, hex-encoded (`secret_key` from the cloud). */
  mqtt_key: string;
  /** PPPP device secret key (`dsk_key`). */
  p2p_key: string;
  api_hosts: string[];
  p2p_hosts: string[];
  /** MQTT broker host (region-derived if absent). */
  mqtt_host?: string;
}

export interface AnkerConfig {
  account: AnkerAccount | null;
  printers: AnkerPrinter[];
  /** DUID of the default-selected printer (`printer select`). */
  selected?: string;
}

/** Region → cloud MQTT broker host. */
export const MQTT_HOSTS: Record<Region, string> = {
  us: "make-mqtt.ankermake.com",
  eu: "make-mqtt-eu.ankermake.com",
};

/** Region → cloud HTTPS app-API host. */
export const API_HOSTS: Record<Region, string> = {
  us: "make-app.ankermake.com",
  eu: "make-app-eu.ankermake.com",
};

export const REDACTED = "<redacted>";

/** MQTT username/password are derived from the account (reference `model.py`). */
export const mqttUsername = (acct: AnkerAccount): string => `eufy_${acct.user_id}`;
export const mqttPassword = (acct: AnkerAccount): string => acct.email;

/** Resolve the per-printer MQTT broker host (explicit, else region default). */
export function mqttHostFor(acct: AnkerAccount, printer: AnkerPrinter): string {
  return printer.mqtt_host ?? MQTT_HOSTS[acct.region];
}

/** OS-appropriate config directory for the `ankerts` app. */
export function configDir(): string {
  const override = process.env.ANKER_CONFIG_DIR;
  if (override) return override;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "ankerts");
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "ankerts");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "ankerts");
  }
}

const emptyConfig = (): AnkerConfig => ({ account: null, printers: [] });

/** A JSON-file-backed configuration store. */
export class ConfigStore {
  constructor(readonly path: string = join(configDir(), "config.json")) {}

  exists(): boolean {
    return existsSync(this.path);
  }

  load(): AnkerConfig {
    if (!existsSync(this.path)) return emptyConfig();
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<AnkerConfig>;
    return {
      account: parsed.account ?? null,
      printers: parsed.printers ?? [],
      ...(parsed.selected ? { selected: parsed.selected } : {}),
    };
  }

  save(config: AnkerConfig): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(config, null, 2)}\n`);
  }

  /** Mutate-and-persist helper. */
  update(fn: (config: AnkerConfig) => void): AnkerConfig {
    const config = this.load();
    fn(config);
    this.save(config);
    return config;
  }
}

/** Return a copy of the config with secrets masked (unless `reveal`). */
export function redactConfig(config: AnkerConfig, reveal = false): AnkerConfig {
  if (reveal) return config;
  return {
    account: config.account
      ? { ...config.account, auth_token: config.account.auth_token ? REDACTED : "" }
      : null,
    printers: config.printers.map((p) => ({
      ...p,
      mqtt_key: p.mqtt_key ? REDACTED : "",
      p2p_key: p.p2p_key ? REDACTED : "",
    })),
    ...(config.selected ? { selected: config.selected } : {}),
  };
}

/**
 * Resolve a printer reference (DUID, serial, name, or numeric index) against the
 * configured list. Returns the printer or null.
 */
export function findPrinter(config: AnkerConfig, ref: string | number): AnkerPrinter | null {
  const { printers } = config;
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const idx = Number(ref);
    return printers[idx] ?? null;
  }
  const r = String(ref);
  return printers.find((p) => p.duid === r || p.sn === r || p.id === r || p.name === r) ?? null;
}
