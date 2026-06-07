/**
 * State-mutating gcode detection (brief §4, lesson #5).
 *
 * Many gcode commands change persistent or volatile machine state. The reference
 * silently let us set Linear Advance K in RAM, contaminating the next print. The
 * SDK flags these so the CLI can warn — noting that the change is volatile, that
 * `M500` persists it to EEPROM, and that `M501` reloads EEPROM to revert.
 */

/** Commands that mutate machine settings (parameter tuning, offsets, currents). */
const VOLATILE_SETTERS = new Set([
  "M92", // steps/mm
  "M201", // max acceleration
  "M203", // max feedrate
  "M204", // accel for print/retract/travel
  "M301", // hotend PID
  "M304", // bed PID
  "M851", // probe Z offset
  "M900", // linear advance K
  "M906", // stepper current (TMC)
  "M913", // hybrid threshold (TMC)
]);

export interface GcodeInspection {
  /** The leading G/M code, uppercased (e.g. `M900`), or null if unparseable. */
  code: string | null;
  /** True if the command writes machine state (volatile or persistent). */
  mutatesState: boolean;
  /** True if the effect lives in volatile RAM until power-cycle or `M501`. */
  volatile: boolean;
  /** True if the command persists settings to EEPROM (`M500`). */
  persists: boolean;
  /** Human-readable note about side effects (empty when none). */
  note: string;
}

/** Extract the leading gcode word (e.g. `M900` from `M900 K0.5 ; comment`). */
export function gcodeCode(command: string): string | null {
  const m = /^\s*([GM]\d+)/i.exec(command);
  return m ? m[1]!.toUpperCase() : null;
}

/** Inspect a gcode command for state-mutation side effects. */
export function inspectGcode(command: string): GcodeInspection {
  const code = gcodeCode(command);
  const base: GcodeInspection = {
    code,
    mutatesState: false,
    volatile: false,
    persists: false,
    note: "",
  };
  if (!code) return base;

  switch (code) {
    case "M500":
      return {
        ...base,
        mutatesState: true,
        persists: true,
        note: "M500 writes current settings to EEPROM — the change persists across power cycles.",
      };
    case "M501":
      return {
        ...base,
        mutatesState: true,
        note: "M501 reloads settings from EEPROM, discarding volatile (RAM) changes.",
      };
    case "M502":
      return {
        ...base,
        mutatesState: true,
        volatile: true,
        note: "M502 resets settings to firmware defaults in RAM (not saved until M500).",
      };
    default:
      if (VOLATILE_SETTERS.has(code)) {
        return {
          ...base,
          mutatesState: true,
          volatile: true,
          note: `${code} changes a machine setting in volatile RAM — it persists until power-cycle and can contaminate the next print. M500 persists it; M501 reverts to the EEPROM value.`,
        };
      }
      return base;
  }
}
