/**
 * Live MQTT transport (brief §5, §6, §6A).
 *
 * Connects to the Anker cloud broker over TLS (pinned CA), subscribes to the
 * printer's notice/reply topics, and drives the gcode request/response cycle.
 * The M5 returns each reply as a single ~512-byte serial-buffer snapshot (not a
 * multi-frame stream — see protocol/gcode.ts), so we collect the reply, settle
 * past the firmware's leading double-`ok`, and hand it to the parser, which
 * flags `truncated` when the snapshot is partial.
 *
 * The transport never writes to stdout/stderr; diagnostics go through an
 * injected `log` callback so the SDK stays I/O-free.
 */
import mqtt, { type MqttClient } from "mqtt";
import { MqttCommandType } from "../protocol/commands.js";
import {
  gcodeHasTerminalOk,
  parseGcodeResult,
  reassembleRaw,
  type GcodeResult,
} from "../protocol/gcode.js";
import { normalizeStatus, type PrinterStatus, type RawNotice } from "../protocol/status.js";
import { TimeoutError } from "../errors.js";
import { ANKERMAKE_MQTT_CA } from "./certs.js";
import { packMqttMessage, parseMqttMessage } from "./mqttframe.js";

export interface MqttClientOptions {
  sn: string;
  /** Per-printer AES key (decoded from the hex `mqtt_key`). */
  key: Buffer;
  host: string;
  port?: number;
  username: string;
  password: string;
  guid?: string;
  /** Override the pinned CA (advanced). */
  ca?: string;
  /** Disable TLS verification (testing only). */
  insecure?: boolean;
  /** Diagnostic sink (defaults to no-op; the CLI routes this to stderr). */
  log?: (msg: string) => void;
}

export interface GcodeWaitOptions {
  /** Hard ceiling before giving up (latency-class aware; default 10s). */
  timeoutMs?: number;
  /** Quiet period with no new frame that signals completion (default 600ms). */
  quietMs?: number;
  /** When false, fire-and-forget: publish and return without collecting. */
  wait?: boolean;
}

const COMMAND_REPLY = (sn: string): string => `/phone/maker/${sn}/command/reply`;
const QUERY_REPLY = (sn: string): string => `/phone/maker/${sn}/query/reply`;
const NOTICE = (sn: string): string => `/phone/maker/${sn}/notice`;
const COMMAND_TOPIC = (sn: string): string => `/device/maker/${sn}/command`;
const QUERY_TOPIC = (sn: string): string => `/device/maker/${sn}/query`;

type NoticeHandler = (notice: RawNotice) => void;

function randomGuid(): string {
  // RFC4122-ish; uniqueness is all that matters for the device GUID field.
  const h = (n: number): string =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${h(8)}-${h(4)}-4${h(3)}-${h(4)}-${h(8)}${h(4)}`;
}

export class AnkerMqttClient {
  private client?: MqttClient;
  private readonly guid: string;
  private readonly log: (msg: string) => void;
  private readonly noticeHandlers = new Set<NoticeHandler>();
  private readonly replyHandlers = new Set<(obj: RawNotice) => void>();
  private readonly latestNotices = new Map<number, RawNotice>();
  private gcodeLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: MqttClientOptions) {
    this.guid = opts.guid ?? randomGuid();
    this.log = opts.log ?? (() => {});
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  async connect(timeoutMs = 30000): Promise<void> {
    const { host, port = 8789, username, password, sn } = this.opts;
    this.log(`mqtt: connecting to ${host}:${port} as ${username}`);
    const client = await mqtt.connectAsync(`mqtts://${host}:${port}`, {
      username,
      password,
      ca: this.opts.ca ?? ANKERMAKE_MQTT_CA,
      rejectUnauthorized: !this.opts.insecure,
      connectTimeout: timeoutMs,
      reconnectPeriod: 0,
    });
    this.client = client;
    client.on("message", (topic, payload) => this.onMessage(topic, payload));
    await client.subscribeAsync([COMMAND_REPLY(sn), QUERY_REPLY(sn), NOTICE(sn)]);
    this.log("mqtt: connected and subscribed");
  }

  async disconnect(): Promise<void> {
    await this.client?.endAsync();
    this.client = undefined;
  }

  private onMessage(_topic: string, payload: Buffer): void {
    let msg;
    try {
      msg = parseMqttMessage(payload, this.opts.key);
    } catch (err) {
      this.log(`mqtt: failed to decode message: ${(err as Error).message}`);
      return;
    }
    const objects = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
    for (const obj of objects) {
      if (obj && typeof obj === "object") {
        const notice = obj as RawNotice;
        if (typeof notice.commandType === "number")
          this.latestNotices.set(notice.commandType, notice);
        for (const h of this.replyHandlers) h(notice);
        for (const h of this.noticeHandlers) h(notice);
      }
    }
  }

  private publish(topic: string, payload: unknown): void {
    if (!this.client) throw new Error("MQTT client not connected");
    const packed = packMqttMessage({ guid: this.guid, payload, key: this.opts.key });
    this.client.publish(topic, packed);
  }

  /** Subscribe to streaming notices. Returns an unsubscribe function. */
  onNotice(handler: NoticeHandler): () => void {
    this.noticeHandlers.add(handler);
    return () => this.noticeHandlers.delete(handler);
  }

  /** Publish a raw command payload (escape hatch for un-modeled commands). */
  command(payload: Record<string, unknown>): void {
    this.publish(COMMAND_TOPIC(this.opts.sn), payload);
  }

  /** Publish a raw query payload. */
  query(payload: Record<string, unknown>): void {
    this.publish(QUERY_TOPIC(this.opts.sn), payload);
  }

  /**
   * Send a single gcode command and return the parsed response (§6). The result
   * carries `truncated` when the firmware's snapshot was partial. Serialized:
   * only one gcode is in flight at a time.
   */
  async gcode(command: string, opts: GcodeWaitOptions = {}): Promise<GcodeResult> {
    const run = this.gcodeLock.then(() => this.gcodeOnce(command, opts));
    // Keep the lock chain alive even if this call rejects.
    this.gcodeLock = run.catch(() => undefined);
    return run;
  }

  private gcodeOnce(command: string, opts: GcodeWaitOptions): Promise<GcodeResult> {
    const { timeoutMs = 10000, quietMs = 600, wait = true } = opts;
    const started = Date.now();

    const payload = {
      commandType: MqttCommandType.GCODE_COMMAND,
      cmdData: command,
      cmdLen: Buffer.byteLength(command, "utf8"),
    };

    if (!wait) {
      this.command(payload);
      return Promise.resolve(
        parseGcodeResult(command, [], { durationMs: Date.now() - started, timedOut: false }),
      );
    }

    return new Promise<GcodeResult>((resolve) => {
      const chunks: string[] = [];
      let lastFrameAt = Date.now();
      let settled = false;

      const finish = (timedOut: boolean): void => {
        if (settled) return;
        settled = true;
        clearInterval(ticker);
        this.replyHandlers.delete(collector);
        resolve(parseGcodeResult(command, chunks, { durationMs: Date.now() - started, timedOut }));
      };

      const collector = (obj: RawNotice): void => {
        if (obj.commandType !== MqttCommandType.GCODE_COMMAND) return;
        const chunk = obj.resData;
        if (typeof chunk === "string") {
          chunks.push(chunk);
          lastFrameAt = Date.now();
        }
      };

      this.replyHandlers.add(collector);
      this.command(payload);

      // The M5 emits a leading/double `ok` before the real echo output, so we
      // never stop on the *first* `ok` (that truncates to `echo:Ad`). Instead:
      // a TRAILING `ok` lets us finish after a short grace for any straggler
      // frame; otherwise the longer quiet period is the floor; the hard timeout
      // is the ceiling.
      const okGraceMs = Math.min(quietMs, 250);
      const ticker = setInterval(
        () => {
          const now = Date.now();
          const idle = now - lastFrameAt;
          if (now - started >= timeoutMs) {
            finish(true); // hard timeout → timedOut = true
          } else if (chunks.length > 0) {
            const trailingOk = gcodeHasTerminalOk(reassembleRaw(chunks));
            if (trailingOk && idle >= okGraceMs)
              finish(false); // settled after a terminal ok
            else if (idle >= quietMs) finish(false); // quiet-period completion
          }
        },
        Math.max(25, Math.floor(okGraceMs / 2)),
      );
    });
  }

  /**
   * Snapshot current printer status by normalizing the latest notice of each
   * type. Optionally nudges the printer with an APP_QUERY_STATUS query and waits
   * briefly for fresh telemetry.
   */
  async getStatus(opts: { refresh?: boolean; waitMs?: number } = {}): Promise<PrinterStatus> {
    const { refresh = true, waitMs = 1200 } = opts;
    if (refresh && this.client) {
      this.query({ commandType: MqttCommandType.APP_QUERY_STATUS });
      await new Promise((r) => setTimeout(r, waitMs));
    }
    return normalizeStatus([...this.latestNotices.values()]);
  }

  /** Throw a structured timeout error (used by waiters). */
  static timeout(message: string, hint?: string): never {
    throw new TimeoutError({ message, transport: "mqtt", hint });
  }
}
