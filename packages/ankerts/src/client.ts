/**
 * `AnkerClient` — the SDK entrypoint (brief §7).
 *
 * Ties the three transports together behind one typed surface: HTTPS for login
 * and config, MQTT for gcode/telemetry/status, PPPP for LAN discovery and file
 * upload. All logic lives here and below; the client returns values and throws
 * typed {@link AnkerError}s — it NEVER writes to stdout/stderr or calls
 * `process.exit`. The CLI owns all I/O, formatting, and exit codes.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  ConfigStore,
  findPrinter,
  mqttHostFor,
  mqttPassword,
  mqttUsername,
  type AnkerConfig,
  type AnkerPrinter,
} from "./config.js";
import { unhex } from "./crypto.js";
import {
  PrinterNotFoundError,
  TimeoutError,
  TransportUnavailableError,
  UsageError,
} from "./errors.js";
import { MqttCommandType, PrintControl } from "./protocol/commands.js";
import type { GcodeResult } from "./protocol/gcode.js";
import type { PrinterStatus, RawNotice } from "./protocol/status.js";
import { transcodeMetadata } from "./protocol/transcoder.js";
import { AnkerMqttClient } from "./transport/mqtt.js";
import { loginAndBuildConfig, type LoginOptions } from "./transport/https.js";
import {
  AnkerPpppClient,
  discoverLan as ppppDiscover,
  type UploadProgress,
} from "./transport/pppp/client.js";
import { conditionHolds, type WaitCondition } from "./wait.js";

export type PrinterEvent = RawNotice;
export type Unsubscribe = () => void;
export type Logger = (msg: string) => void;

export interface AnkerClientOptions {
  store?: ConfigStore;
  log?: Logger;
  printer?: string | number;
  /** Disable TLS verification on transports (testing only). */
  insecure?: boolean;
}

export interface GcodeOptions {
  timeoutMs?: number;
  quietMs?: number;
  wait?: boolean;
  /** Append M400 semantics so the call returns on true motion completion. */
  waitMotion?: boolean;
}

export interface WaitOptions {
  source?: "events" | "poll" | "hybrid";
  pollMs?: number;
  timeoutMs?: number;
  onTick?: (status: PrinterStatus) => void;
}

export interface MachineSettings {
  /**
   * The M503 result. NOTE: M503's output usually exceeds the firmware's
   * ~512-byte reply window, so this can be partial — check `result.truncated`
   * before treating `reports` as the complete settings set.
   */
  result: GcodeResult;
  reports: Record<string, string>;
  linearAdvanceK?: number;
  hotendPid?: { p: number; i: number; d: number };
  steps?: string;
  probeZOffset?: number;
}

export interface JobResult {
  name: string;
  size: number;
  md5: string;
  started: boolean;
  transport: "lan";
  duid: string;
  ip: string;
}

export interface LanDiscoverOptions {
  retries?: number;
  timeoutMs?: number;
  store?: boolean;
}

/** Per-command default gcode timeouts by latency class (§6A). */
export function defaultTimeoutFor(command: string): number {
  const code = /^\s*([GM]\d+)/i.exec(command)?.[1]?.toUpperCase();
  switch (code) {
    case "M109": // heat-and-wait hotend
    case "M190": // heat-and-wait bed
    case "M303": // PID autotune
    case "G29": // auto bed leveling
      return 600000; // minutes
    case "G28": // homing
    case "M400": // motion barrier
      return 120000;
    default:
      return 10000; // instant/report commands
  }
}

export class AnkerClient {
  private config: AnkerConfig;
  private readonly store?: ConfigStore;
  private readonly log: Logger;
  private readonly insecure: boolean;
  private printerRef?: string | number;
  private mqtt?: AnkerMqttClient;

  constructor(config: AnkerConfig, opts: AnkerClientOptions = {}) {
    this.config = config;
    this.store = opts.store;
    this.log = opts.log ?? (() => {});
    this.insecure = opts.insecure ?? false;
    this.printerRef = opts.printer;
  }

  // --- construction / auth (HTTPS) ---

  static async login(opts: LoginOptions & { save?: boolean }): Promise<AnkerClient> {
    const config = await loginAndBuildConfig(opts);
    const store = new ConfigStore();
    if (opts.save) store.save(config);
    return new AnkerClient(config, { store });
  }

  static fromStoredConfig(path?: string, opts: AnkerClientOptions = {}): AnkerClient {
    const store = opts.store ?? new ConfigStore(path);
    return new AnkerClient(store.load(), { ...opts, store });
  }

  getConfig(): AnkerConfig {
    return this.config;
  }

  // --- account / selection ---

  listPrinters(): AnkerPrinter[] {
    return this.config.printers;
  }

  selectPrinter(ref: string | number): AnkerPrinter {
    const printer = findPrinter(this.config, ref);
    if (!printer) throw this.notFound(ref);
    this.printerRef = printer.duid;
    this.config.selected = printer.duid;
    this.store?.update((c) => {
      c.selected = printer.duid;
    });
    return printer;
  }

  /** The currently selected printer (explicit ref → stored default → first). */
  currentPrinter(): AnkerPrinter {
    if (this.config.printers.length === 0) {
      throw new PrinterNotFoundError({
        message: "No printers configured",
        hint: "Run `ankerts login --save` to populate the account's printer list.",
      });
    }
    const ref = this.printerRef ?? this.config.selected;
    if (ref !== undefined) {
      const p = findPrinter(this.config, ref);
      if (!p) throw this.notFound(ref);
      return p;
    }
    return this.config.printers[0]!;
  }

  private notFound(ref: string | number): PrinterNotFoundError {
    return new PrinterNotFoundError({
      message: `Printer "${ref}" not found on the account`,
      hint: "List printers with `ankerts printer list`.",
      input: { printer: ref },
    });
  }

  private account() {
    if (!this.config.account) {
      throw new PrinterNotFoundError({
        code: "not_logged_in",
        message: "Not logged in",
        transport: "https",
        hint: "Run `ankerts login --email … --password … --country … --save`.",
      });
    }
    return this.config.account;
  }

  // --- MQTT lifecycle ---

  private async ensureMqtt(): Promise<AnkerMqttClient> {
    if (this.mqtt?.connected) return this.mqtt;
    const account = this.account();
    const printer = this.currentPrinter();
    this.mqtt = new AnkerMqttClient({
      sn: printer.sn,
      key: unhex(printer.mqtt_key),
      host: mqttHostFor(account, printer),
      username: mqttUsername(account),
      password: mqttPassword(account),
      insecure: this.insecure,
      log: this.log,
    });
    await this.mqtt.connect();
    return this.mqtt;
  }

  /** Close any open transports. */
  async close(): Promise<void> {
    await this.mqtt?.disconnect();
    this.mqtt = undefined;
  }

  // --- telemetry / status (MQTT) ---

  async getStatus(): Promise<PrinterStatus> {
    const mqtt = await this.ensureMqtt();
    return mqtt.getStatus();
  }

  async subscribeEvents(handler: (e: PrinterEvent) => void): Promise<Unsubscribe> {
    const mqtt = await this.ensureMqtt();
    return mqtt.onNotice(handler);
  }

  // --- gcode (MQTT, §6) ---

  async gcode(command: string, opts: GcodeOptions = {}): Promise<GcodeResult> {
    const mqtt = await this.ensureMqtt();
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutFor(command);
    const result = await mqtt.gcode(command, { timeoutMs, quietMs: opts.quietMs, wait: opts.wait });

    if (opts.waitMotion && opts.wait !== false) {
      // M400 returns `ok` only when all queued moves have physically finished.
      const motion = await mqtt.gcode("M400", { timeoutMs: defaultTimeoutFor("M400") });
      return {
        ...result,
        raw: `${result.raw}\n${motion.raw}`,
        lines: [...result.lines, ...motion.lines],
        ok: motion.ok,
        timedOut: result.timedOut || motion.timedOut,
        frames: result.frames + motion.frames,
        durationMs: result.durationMs + motion.durationMs,
      };
    }
    return result;
  }

  /** Run many commands, yielding each result as it completes (NDJSON-friendly). */
  async *gcodeBatch(commands: string[], opts: GcodeOptions = {}): AsyncIterable<GcodeResult> {
    for (const command of commands) {
      if (command.trim() === "") continue;
      yield await this.gcode(command, opts);
    }
  }

  // --- state helpers ---

  async snapshotState(): Promise<MachineSettings> {
    const result = await this.gcode("M503", { timeoutMs: 15000 });
    const reports = result.reports;
    const pid = reports.M301?.match(/P([\d.]+)\s+I([\d.]+)\s+D([\d.]+)/);
    const settings: MachineSettings = { result, reports };
    if (reports.M900) {
      const k = reports.M900.match(/K([\d.]+)/);
      if (k) settings.linearAdvanceK = Number(k[1]);
    }
    if (pid) settings.hotendPid = { p: Number(pid[1]), i: Number(pid[2]), d: Number(pid[3]) };
    if (reports.M92) settings.steps = reports.M92;
    const z = reports.M851?.match(/Z(-?[\d.]+)/);
    if (z) settings.probeZOffset = Number(z[1]);
    return settings;
  }

  async restoreState(): Promise<GcodeResult> {
    return this.gcode("M501", { timeoutMs: 15000 });
  }

  // --- job control (MQTT) ---
  //
  // PRINT_CONTROL (0x03f0) with the `value` codes in PrintControl, reverse-
  // engineered and confirmed live against an M5 (2026-06-07): cancel drops the
  // job to idle with heaters off; pause/resume toggle the print.

  async cancelJob(): Promise<void> {
    (await this.ensureMqtt()).command({
      commandType: MqttCommandType.PRINT_CONTROL,
      value: PrintControl.STOP,
    });
  }
  async pauseJob(): Promise<void> {
    (await this.ensureMqtt()).command({
      commandType: MqttCommandType.PRINT_CONTROL,
      value: PrintControl.PAUSE,
    });
  }
  async resumeJob(): Promise<void> {
    (await this.ensureMqtt()).command({
      commandType: MqttCommandType.PRINT_CONTROL,
      value: PrintControl.RESUME,
    });
  }

  // --- discovery + jobs (PPPP, LAN) ---

  async discoverLan(opts: LanDiscoverOptions = {}): Promise<{ duid: string; ip: string }[]> {
    const { retries = 3, timeoutMs = 1000, store = false } = opts;
    let found: { duid: string; ip: string }[] = [];
    for (let attempt = 1; attempt <= retries; attempt++) {
      this.log(`pppp: LAN discovery attempt ${attempt}/${retries}`);
      found = await ppppDiscover({ timeoutMs, log: this.log });
      if (found.length > 0) break;
    }
    if (store && found.length > 0) {
      this.config = this.persistDiscoveredIps(found);
    }
    return found;
  }

  private persistDiscoveredIps(found: { duid: string; ip: string }[]): AnkerConfig {
    const apply = (c: AnkerConfig): void => {
      for (const f of found) {
        const p = c.printers.find((x) => x.duid === f.duid);
        if (p) p.ip_addr = f.ip;
      }
    };
    if (this.store) return this.store.update(apply);
    apply(this.config);
    return this.config;
  }

  /**
   * Upload a gcode file over the LAN and (by default) start the print. Auto-runs
   * discovery if the printer's IP is unknown; if it's still unreachable, throws
   * {@link TransportUnavailableError} (exit 6) naming the transport and the fix.
   */
  async uploadAndPrint(
    file: string | Buffer,
    opts: {
      start?: boolean;
      transport?: "lan" | "auto";
      fixMetadata?: boolean;
      filename?: string;
      onProgress?: (p: UploadProgress) => void;
    } = {},
  ): Promise<JobResult> {
    let printer = this.currentPrinter();
    const filename = opts.filename ?? (typeof file === "string" ? basename(file) : "print.gcode");
    let data: Buffer;
    if (typeof file === "string") {
      try {
        data = await readFile(file);
      } catch (cause) {
        throw new UsageError({
          code: "file_not_found",
          message: `Cannot read gcode file: ${file}`,
          hint: "Check the path. Provide a sliced .gcode file to upload.",
          input: { file },
          cause,
        });
      }
    } else {
      data = file;
    }

    if (opts.fixMetadata) {
      const transcoded = transcodeMetadata(data.toString("utf8"));
      if (transcoded.changed) {
        this.log(`transcoder: injected Anker metadata (${JSON.stringify(transcoded.injected)})`);
        data = Buffer.from(transcoded.content, "utf8");
      }
    }

    // Ensure we have a LAN IP — upload is LAN-only (PPPP).
    if (!printer.ip_addr) {
      this.log("pppp: no stored IP — running discovery");
      await this.discoverLan({ store: true });
      printer = this.currentPrinter();
    }
    if (!printer.ip_addr) {
      throw new TransportUnavailableError({
        code: "lan_printer_unreachable",
        message: `Printer ${printer.duid} not found on the local network`,
        transport: "pppp",
        hint: "File upload is LAN-only (PPPP). Run `ankerts discover --store` while on the same LAN as the printer, then retry.",
        input: { file: filename },
      });
    }

    const pppp = new AnkerPpppClient({ duid: printer.duid, host: printer.ip_addr, log: this.log });
    try {
      await pppp.connect();
      const account = this.config.account;
      const res = await pppp.uploadFile(filename, data, {
        start: opts.start,
        userName: account?.email ?? "ankerts",
        userId: account?.user_id ?? "-",
        onProgress: opts.onProgress,
      });
      return { ...res, transport: "lan", duid: printer.duid, ip: printer.ip_addr };
    } finally {
      pppp.stop();
    }
  }

  // --- waiting (§6A) ---

  /**
   * Block until `cond` holds, resolving the current status. Re-attachable: it
   * re-derives state from fresh snapshots, so a re-issued wait still resolves.
   * Rejects with a retriable {@link TimeoutError} (exit 5) on timeout.
   */
  async waitFor(cond: WaitCondition, opts: WaitOptions = {}): Promise<PrinterStatus> {
    const { pollMs = 2000, timeoutMs = 600000, onTick } = opts;
    const deadline = Date.now() + timeoutMs;

    // Transport-only conditions resolve without status polling.
    if (cond.kind === "connected") {
      await this.ensureMqtt();
      return this.getStatus();
    }
    if (cond.kind === "lan") {
      const found = await this.discoverLan({ store: true, retries: Math.ceil(timeoutMs / 1000) });
      if (found.length === 0) {
        throw new TimeoutError({
          message: "Printer not found on the local network within the timeout",
          transport: "pppp",
          hint: "Ensure you are on the same LAN as the printer and it is powered on.",
        });
      }
      return this.getStatus();
    }

    // hybrid/poll/events: poll server-authoritative status as the robust floor.
    for (;;) {
      const status = await this.getStatus();
      onTick?.(status);
      if (conditionHolds(cond, status) === true) return status;
      if (Date.now() >= deadline) {
        throw new TimeoutError({
          message: `Condition "${cond.kind}" not met within ${timeoutMs}ms`,
          transport: "mqtt",
          hint: "Waits are re-attachable — re-run the same `printer wait` to continue.",
          input: { condition: cond.kind },
        });
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
