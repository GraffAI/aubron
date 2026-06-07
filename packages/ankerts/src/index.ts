/**
 * @aubron/ankerts — agent-first SDK for AnkerMake / eufyMake M5 printers.
 *
 * SDK-first: all protocol logic lives here, fully typed. The SDK never writes to
 * stdout/stderr or calls process.exit — it returns values and throws typed
 * {@link AnkerError}s. The CLI (`@aubron/ankerts-cli`) is a thin formatting shell
 * on top of this surface.
 */

// Main entrypoint
export {
  AnkerClient,
  defaultTimeoutFor,
  type AnkerClientOptions,
  type GcodeOptions,
  type JobResult,
  type LanDiscoverOptions,
  type Logger,
  type MachineSettings,
  type PrinterEvent,
  type Unsubscribe,
  type WaitOptions,
} from "./client.js";

// Config + types
export {
  API_HOSTS,
  ConfigStore,
  MQTT_HOSTS,
  REDACTED,
  configDir,
  findPrinter,
  mqttHostFor,
  mqttPassword,
  mqttUsername,
  redactConfig,
  type AnkerAccount,
  type AnkerConfig,
  type AnkerPrinter,
  type Region,
} from "./config.js";

// Errors (exit-code mapping lives on the classes)
export {
  AnkerError,
  AuthError,
  PrinterNotFoundError,
  PrinterRejectedError,
  TimeoutError,
  TransportUnavailableError,
  UsageError,
  toAnkerError,
  type AnkerErrorBody,
  type Transport,
} from "./errors.js";

// Protocol — gcode (the centerpiece, §6)
export {
  gcodeHasTerminalOk,
  parseGcodeResult,
  reassembleRaw,
  splitLines,
  stripAnsi,
  type GcodeResult,
} from "./protocol/gcode.js";

// Protocol — status (§5, §4A)
export {
  isEtaReliable,
  normalizeStatus,
  type JobState,
  type PrinterStatus,
  type RawNotice,
} from "./protocol/status.js";

// Protocol — gcode safety (§4) + metadata transcoder (§4A)
export { gcodeCode, inspectGcode, type GcodeInspection } from "./protocol/safety.js";
export {
  detectSlicer,
  hasAnkerTimeHeader,
  parseDurationToSeconds,
  transcodeMetadata,
  type TranscodeResult,
} from "./protocol/transcoder.js";

// Protocol — command enums
export { MqttCommandType, NoticeType, PrintControl } from "./protocol/commands.js";

// Waiting (§6A)
export {
  conditionHolds,
  describeWaitCondition,
  parseWaitCondition,
  type WaitCondition,
} from "./wait.js";

// Transport entrypoints (advanced)
export { AnkerMqttClient, type MqttClientOptions } from "./transport/mqtt.js";
export {
  AnkerHttpApi,
  guessRegion,
  loginAndBuildConfig,
  type LoginOptions,
  type LoginResult,
} from "./transport/https.js";
export {
  AnkerPpppClient,
  discoverLan,
  PPPP_LAN_PORT,
  PpppState,
  type LanPrinter,
  type UploadProgress,
} from "./transport/pppp/client.js";
