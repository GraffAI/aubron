/**
 * MQTT `commandType` enum and notice identifiers, extracted from the reference
 * `libflagship/mqtt.py` and the live captures documented in the brief (§5).
 *
 * The firmware speaks numeric command types; we name the ones that matter and
 * leave the rest reachable through the raw `send`/numeric value.
 */

/** MQTT command/notice types (`commandType` field). Values are decimal. */
export enum MqttCommandType {
  EVENT_NOTIFY = 0x03e8, // 1000
  PRINT_SCHEDULE = 0x03e9, // 1001
  FIRMWARE_VERSION = 0x03ea, // 1002
  NOZZLE_TEMP = 0x03eb, // 1003 — 1/100 °C
  HOTBED_TEMP = 0x03ec, // 1004 — 1/100 °C
  FAN_SPEED = 0x03ed, // 1005
  PRINT_SPEED = 0x03ee, // 1006
  AUTO_LEVELING = 0x03ef, // 1007
  PRINT_CONTROL = 0x03f0, // 1008
  FILE_LIST_REQUEST = 0x03f1, // 1009
  APP_QUERY_STATUS = 0x0403, // 1027
  ONLINE_NOTIFY = 0x0404, // 1028
  RECOVER_FACTORY = 0x0405, // 1029
  BREAK_POINT = 0x040f, // 1039
  MODEL_LAYER = 0x041c, // 1052
  GCODE_COMMAND = 0x0413, // 1043 — raw gcode in/out
}

/** Notice `commandType` values seen streaming on `.../notice` (decimal §5). */
export enum NoticeType {
  EVENT_NOTIFY = 1000,
  PRINT_SCHEDULE = 1001,
  NOZZLE_TEMP = 1003,
  HOTBED_TEMP = 1004,
  PRINT_SPEED = 1006,
  MODEL_LAYER = 1052,
}

/**
 * `PRINT_CONTROL` (0x03f0) `value` for job control. Reverse-engineered live
 * against an M5 (2026-06-07): each value was sent and confirmed by watching the
 * printer's authoritative job state and heater targets.
 */
export enum PrintControl {
  PAUSE = 2, // → state 2 (paused), progress freezes
  RESUME = 3, // → state 1 (printing)
  STOP = 4, // → state 0 (idle), nozzle + bed targets drop to 0
}

/** Job state reported by `EVENT_NOTIFY` (0x03e8) with `subType: 1`. */
export enum PrintState {
  IDLE = 0,
  PRINTING = 1,
  PAUSED = 2,
}
