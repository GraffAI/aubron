# @aubron/ankerts

An **agent-first TypeScript SDK** for AnkerMake / eufyMake **M5**-class printers.
It speaks the printer's three transports behind one typed surface and is built to
be driven by agents and scripts — not just humans at a terminal.

The CLI wrapper lives in [`@aubron/ankerts-cli`](../ankerts-cli) (`ankerts`). This
package is the SDK: **all protocol logic, fully typed, with no console I/O.** It
returns values and throws typed errors; the CLI owns formatting and exit codes.

## The three transports (and the cloud-vs-LAN split)

| Transport             | Used for                             | Reachability                     |
| --------------------- | ------------------------------------ | -------------------------------- |
| **MQTT over TLS**     | gcode, status/telemetry, job control | anywhere (internet + creds)      |
| **PPPP** (P2P/UDP)    | LAN file upload, camera              | **LAN only** (needs a stored IP) |
| **HTTPS** (cloud API) | login, account & printer list        | anywhere                         |

Cloud-reachable ≠ LAN-reachable: gcode can work while a file upload cannot, until
the printer's IP is discovered on the LAN.

## Install

```sh
npm add @aubron/ankerts
```

## Quick start

```ts
import { AnkerClient } from "@aubron/ankerts";

// Log in (HTTPS) and persist credentials + printer list.
const client = await AnkerClient.login({
  email: "me@example.com",
  password: process.env.ANKER_PASSWORD!,
  country: "US",
  save: true,
});

// Or load a previously stored config.
const c = AnkerClient.fromStoredConfig();

// Send gcode and get the COMPLETE, reassembled, parsed response (MQTT).
const r = await c.gcode("M900"); // Linear Advance query
console.log(r.fields["Advance K"]); // "0.00" — never a truncated "echo:Ad"

// Status, normalized to °C and 0–100% (bogus third-party-gcode ETA suppressed).
const status = await c.getStatus();

// Wait for a condition — re-attachable, derived from server state.
import { parseWaitCondition } from "@aubron/ankerts";
await c.waitFor(parseWaitCondition("printing"), { timeoutMs: 120_000 });

// Upload + start over the LAN (auto-discovers the IP; throws exit-6 if off-LAN).
await c.uploadAndPrint("tower.gcode");
await c.close();
```

## The centerpiece: complete gcode responses

A command's output arrives as **one or more** MQTT reply frames. The reference
implementation returned only the first, truncating multi-frame replies. This SDK
concatenates every `resData` chunk in arrival order, strips ANSI, and parses the
result into a `GcodeResult`:

```ts
interface GcodeResult {
  command: string;
  raw: string; // full reassembled text, ANSI-free
  lines: string[];
  ok: boolean; // a terminal `ok` was seen
  recognized: boolean; // false iff `echo:Unknown command`
  fields: Record<string, string>; // echo:Key=Value / KEY:VALUE
  reports: Record<string, string>; // Marlin report lines keyed by M-code
  durationMs: number;
  timedOut: boolean; // distinct from `recognized: false`
  frames: number; // diagnostic: frames reassembled
}
```

Completion is detected by a terminal `ok`, a quiet period, or a hard timeout.
Timeouts are latency-class aware (`M109/M190/G29/M303` get minutes), and
`{ waitMotion: true }` appends `M400` so a move returns on true completion, not
queue-accept.

## Typed errors → exit codes

Every error carries `{ code, message, transport?, retriable, hint, input }` and
maps to a documented CLI exit code:

| Error                       | Exit | Meaning                                |
| --------------------------- | ---- | -------------------------------------- |
| `UsageError`                | 2    | bad/missing args                       |
| `AuthError`                 | 3    | login required/expired/captcha         |
| `PrinterNotFoundError`      | 4    | printer not found / not selected       |
| `TimeoutError`              | 5    | connectivity/timeout — **retriable**   |
| `TransportUnavailableError` | 6    | op needs a transport the printer lacks |
| `PrinterRejectedError`      | 7    | printer-side rejection                 |

## Notes

- ESM only (`"type": "module"`), Node ≥ 22.
- Crypto, MQTT framing, and the PPPP protocol are ported faithfully from the
  AnkerMake reference implementation; framing/crypto are unit-tested via
  round-trips, and the gcode parser/status/transcoder are tested against the
  observed fixtures. The live transports require a real printer to exercise.
