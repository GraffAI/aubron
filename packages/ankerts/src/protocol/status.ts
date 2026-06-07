/**
 * Printer status/telemetry normalization (brief §5 + §4A).
 *
 * Notices stream continuously over MQTT `.../notice`. They carry raw firmware
 * units — temperatures in 1/100 °C, progress in 1/100 % — which we normalize so
 * callers never touch raw values. Crucially, for third-party-sliced gcode the
 * firmware's headline ETA is garbage (§4A); we detect that and mark the ETA
 * unreliable rather than surfacing a bogus 20,000-hour estimate.
 */

import { NoticeType } from "./commands.js";

export type JobState = "idle" | "printing" | "paused" | "complete" | "failed" | "cancelled";

export interface PrinterStatus {
  nozzle: { current: number; target: number }; // °C
  bed: { current: number; target: number }; // °C
  job?: {
    name: string;
    state: JobState;
    progressPct: number; // 0..100
    layer: number;
    totalLayers: number;
    etaSeconds?: number; // omitted when unreliable (§4A)
    etaReliable?: boolean;
    filamentUsed?: number;
    filamentUnit?: string;
    speedMmS?: number;
    speedFactorPct?: number;
  };
  raw: Record<string, unknown>; // original notice payloads — escape hatch
}

/** A raw notice payload: at minimum a `commandType`, plus arbitrary fields. */
export type RawNotice = Record<string, unknown> & { commandType?: number };

const centiToC = (v: number): number => Math.round((v / 100) * 100) / 100;
const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : undefined;

// A remaining/total time this large almost certainly comes from un-populated
// Anker metadata in third-party gcode (the observed bug showed ~20,000 hours).
const SANE_ETA_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Decide whether a `print_schedule` notice's ETA is trustworthy. Native
 * AnkerMake/eufyMake gcode carries the proprietary time metadata the firmware
 * needs; third-party slicers (OrcaSlicer/PrusaSlicer) do not, so the firmware
 * emits an inconsistent `time` vs `totalTime` and an absurd remaining time.
 */
export function isEtaReliable(schedule: RawNotice): boolean {
  const totalTime = num(schedule.totalTime);
  const time = num(schedule.time);
  const left = num(schedule.startLeftTime);
  if (totalTime === undefined || totalTime <= 0) return false;
  // `time` should never exceed the total for a real print; if it does, the
  // field was never populated correctly (the §4A tell: time≫totalTime).
  if (time !== undefined && time > totalTime) return false;
  if (left !== undefined && (left < 0 || left > SANE_ETA_SECONDS)) return false;
  return true;
}

function deriveState(schedule: RawNotice | undefined, progressPct: number): JobState {
  const hint = schedule?.state;
  if (typeof hint === "string") {
    const h = hint.toLowerCase();
    if (["idle", "printing", "paused", "complete", "failed", "cancelled"].includes(h)) {
      return h as JobState;
    }
  }
  if (!schedule || !schedule.name) return "idle";
  if (progressPct >= 100) return "complete";
  return "printing";
}

/**
 * Fold a set of notice payloads into a normalized {@link PrinterStatus}.
 * The latest notice of each type wins. `etaReliableOverride` lets a caller that
 * already knows the file is third-party force the ETA to be marked unreliable.
 */
export function normalizeStatus(
  notices: readonly RawNotice[],
  opts: { etaReliableOverride?: boolean } = {},
): PrinterStatus {
  const latest = new Map<number, RawNotice>();
  for (const n of notices) {
    if (typeof n.commandType === "number") latest.set(n.commandType, n);
  }

  const nozzleN = latest.get(NoticeType.NOZZLE_TEMP);
  const bedN = latest.get(NoticeType.HOTBED_TEMP);
  const layerN = latest.get(NoticeType.MODEL_LAYER);
  const speedN = latest.get(NoticeType.PRINT_SPEED);
  const schedule = latest.get(NoticeType.PRINT_SCHEDULE);

  const raw: Record<string, unknown> = {};
  for (const [type, payload] of latest) raw[String(type)] = payload;

  const status: PrinterStatus = {
    nozzle: {
      current: centiToC(num(nozzleN?.currentTemp) ?? 0),
      target: centiToC(num(nozzleN?.targetTemp) ?? 0),
    },
    bed: {
      current: centiToC(num(bedN?.currentTemp) ?? 0),
      target: centiToC(num(bedN?.targetTemp) ?? 0),
    },
    raw,
  };

  if (schedule) {
    const progressPct = Math.round(((num(schedule.progress) ?? 0) / 100) * 100) / 100;
    const reliable = opts.etaReliableOverride ?? isEtaReliable(schedule);
    const left = num(schedule.startLeftTime);

    status.job = {
      name: typeof schedule.name === "string" ? schedule.name : "",
      state: deriveState(schedule, progressPct),
      progressPct,
      layer: num(layerN?.real_print_layer) ?? 0,
      totalLayers: num(layerN?.total_layer) ?? 0,
      etaReliable: reliable,
      ...(reliable && left !== undefined ? { etaSeconds: left } : {}),
      ...(num(schedule.filamentUsed) !== undefined
        ? { filamentUsed: num(schedule.filamentUsed) }
        : {}),
      ...(typeof schedule.filamentUnit === "string" ? { filamentUnit: schedule.filamentUnit } : {}),
      ...(num(speedN?.value) !== undefined ? { speedMmS: num(speedN?.value) } : {}),
      ...(num(schedule.realSpeed) !== undefined ? { speedFactorPct: num(schedule.realSpeed) } : {}),
    };
  }

  return status;
}
