---
"@aubron/ankerts": minor
"@aubron/ankerts-cli": minor
---

Initial release of `ankerts` — an agent-first TypeScript SDK + CLI for
AnkerMake / eufyMake M5 printers.

- **`@aubron/ankerts`** (SDK): typed client over the printer's three transports —
  MQTT (gcode, status, control), PPPP (LAN discovery + file upload), and HTTPS
  (login, account, printer list). Centerpiece: complete multi-frame gcode
  request/response reassembly (no truncated `echo:Ad` replies), unit-normalized
  status (1/100 °C → °C, progress → %), third-party-gcode ETA detection, a gcode
  metadata transcoder, state-mutation detection, typed errors with exit-code
  mapping, and a re-attachable `waitFor`. The SDK does no console I/O.
- **`@aubron/ankerts-cli`** (CLI, bin `ankerts`): a thin shell with agent-first
  conventions — json/ndjson/text output (json default when piped), data on
  stdout / logs on stderr, `--quiet`/`--fields`, structured errors, documented
  exit codes, rich per-command `--help`, and `describe --json` introspection.
