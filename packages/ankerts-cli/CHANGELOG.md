# @aubron/ankerts-cli

## 0.1.1

### Patch Changes

- [#7](https://github.com/GraffAI/aubron/pull/7) [`16af498`](https://github.com/GraffAI/aubron/commit/16af498d068899425f7c6ba79e7163617275f35f) Thanks [@Aubron](https://github.com/Aubron)! - Fix `print`: the automatic slicer metadata-fix never ran on a real upload. The
  `uploadAndPrint` call checked a renamed/nonexistent `--fix-metadata` flag (always
  false) while only the `--dry-run` report used the correct `--no-fix-metadata`
  opt-out — so dry-run looked right but every actual upload skipped the `;TIME:`
  injection (third-party slices showed 00:00 ETA). The value is now computed once
  and used in both paths.

## 0.1.0

### Minor Changes

- [#2](https://github.com/GraffAI/aubron/pull/2) [`43d9df1`](https://github.com/GraffAI/aubron/commit/43d9df1a05212a44c24ef643667efd4331a6a4dd) Thanks [@Aubron](https://github.com/Aubron)! - Initial release of `ankerts` — an agent-first TypeScript SDK + CLI for
  AnkerMake / eufyMake M5 printers.
  - **`@aubron/ankerts`** (SDK): typed client over the printer's three transports —
    MQTT (gcode, status, control), PPPP (LAN discovery + file upload), and HTTPS
    (login, account, printer list). Gcode replies are parsed into a structured
    result and flagged `truncated` when the firmware's ~512-byte serial-buffer
    snapshot is partial (rather than silently returning `echo:Ad` like the
    reference). Plus unit-normalized status (1/100 °C → °C, progress → %),
    third-party-gcode ETA detection, a gcode metadata transcoder, state-mutation
    detection, typed errors with exit-code mapping, and a re-attachable `waitFor`.
    The SDK does no console I/O.
  - **`@aubron/ankerts-cli`** (CLI, bin `ankerts`): a thin shell with agent-first
    conventions — json/ndjson/text output (json default when piped), data on
    stdout / logs on stderr, `--quiet`/`--fields`, structured errors, documented
    exit codes, rich per-command `--help`, and `describe --json` introspection.

### Patch Changes

- Updated dependencies [[`43d9df1`](https://github.com/GraffAI/aubron/commit/43d9df1a05212a44c24ef643667efd4331a6a4dd)]:
  - @aubron/ankerts@0.1.0
