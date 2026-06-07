/**
 * Waitable conditions over server-authoritative printer state (brief §6A).
 *
 * Every wait is re-derivable from a fresh status snapshot, which is what makes
 * waits re-attachable: an agent that crashed or timed out mid-wait can re-issue
 * the same wait and it resolves against current state — no dependence on a live
 * subscription. This module is the pure predicate layer; `AnkerClient.waitFor`
 * supplies the polling/event loop.
 */
import type { PrinterStatus } from "./protocol/status.js";

export type WaitCondition =
  | { kind: "connected" }
  | { kind: "lan" }
  | { kind: "nozzle"; atLeast: number }
  | { kind: "bed"; atLeast: number }
  | { kind: "temp-stable" }
  | { kind: "printing" }
  | { kind: "idle" }
  | { kind: "progress"; atLeast: number }
  | { kind: "layer"; atLeast: number }
  | { kind: "complete" }
  | { kind: "failed" }
  | { kind: "cancelled" }
  | { kind: "runout" };

/** Temperatures within this band of target count as "stable". */
const TEMP_STABLE_DELTA = 2.0;

/**
 * Parse a CLI condition string such as `nozzle>=210`, `progress>=50`, or
 * `complete` into a {@link WaitCondition}.
 */
export function parseWaitCondition(input: string): WaitCondition {
  const s = input.trim();
  const cmp = /^(nozzle|bed|progress|layer)\s*>=\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (cmp) {
    const value = Number(cmp[2]);
    switch (cmp[1]) {
      case "nozzle":
        return { kind: "nozzle", atLeast: value };
      case "bed":
        return { kind: "bed", atLeast: value };
      case "progress":
        return { kind: "progress", atLeast: value };
      case "layer":
        return { kind: "layer", atLeast: value };
    }
  }
  switch (s) {
    case "connected":
    case "lan":
    case "temp-stable":
    case "printing":
    case "idle":
    case "complete":
    case "failed":
    case "cancelled":
    case "runout":
      return { kind: s };
    default:
      throw new Error(
        `unknown wait condition: "${input}" (try connected|lan|nozzle>=C|bed>=C|` +
          `temp-stable|printing|idle|progress>=pct|layer>=n|complete|failed|cancelled|runout)`,
      );
  }
}

/** Render a condition back to its canonical string form. */
export function describeWaitCondition(cond: WaitCondition): string {
  switch (cond.kind) {
    case "nozzle":
      return `nozzle>=${cond.atLeast}`;
    case "bed":
      return `bed>=${cond.atLeast}`;
    case "progress":
      return `progress>=${cond.atLeast}`;
    case "layer":
      return `layer>=${cond.atLeast}`;
    default:
      return cond.kind;
  }
}

/**
 * Evaluate a status-derived condition against a snapshot. Transport-only
 * conditions (`connected`, `lan`) return `null` — the caller resolves those from
 * transport state, not status.
 */
export function conditionHolds(cond: WaitCondition, status: PrinterStatus): boolean | null {
  const job = status.job;
  switch (cond.kind) {
    case "connected":
    case "lan":
      return null;
    case "nozzle":
      return status.nozzle.current >= cond.atLeast;
    case "bed":
      return status.bed.current >= cond.atLeast;
    case "temp-stable": {
      const nozzleOk =
        status.nozzle.target > 0 &&
        Math.abs(status.nozzle.current - status.nozzle.target) <= TEMP_STABLE_DELTA;
      const bedOk =
        status.bed.target <= 0 ||
        Math.abs(status.bed.current - status.bed.target) <= TEMP_STABLE_DELTA;
      return nozzleOk && bedOk;
    }
    case "printing":
      return job?.state === "printing";
    case "idle":
      return !job || job.state === "idle" || job.state === "complete";
    case "progress":
      return (job?.progressPct ?? -1) >= cond.atLeast;
    case "layer":
      return (job?.layer ?? -1) >= cond.atLeast;
    case "complete":
      return job?.state === "complete";
    case "failed":
      return job?.state === "failed";
    case "cancelled":
      return job?.state === "cancelled";
    case "runout":
      // Best-effort: a runout surfaces as a failed job or a runout event in raw.
      return job?.state === "failed" || JSON.stringify(status.raw).toLowerCase().includes("runout");
  }
}
