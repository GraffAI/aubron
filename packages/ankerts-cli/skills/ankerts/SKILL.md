---
name: ankerts
description: Drive an AnkerMake / eufyMake M5-class 3D printer with the `ankerts` CLI — send gcode and read complete responses, query status, discover the printer on the LAN, and upload + start prints. Use this whenever the task involves an AnkerMake or eufyMake M5 printer, the `ankerts` command, sending gcode (M-codes / G-codes) to a printer, checking nozzle/bed temps or print progress, or uploading a sliced .gcode file to print.
---

# ankerts

`ankerts` is an agent-first CLI for AnkerMake / eufyMake M5 printers. It's built
to be driven by you: structured output, clean streams, documented exit codes.

**Before anything else, learn the full surface in one call:**

```sh
ankerts describe --json
```

That returns every command, flag, type, default, exit code, and worked example.
`ankerts --help` and `ankerts <command> --help` give the same per-command detail.

## Output contract (rely on this)

- **Data → stdout; logs/progress/errors → stderr.** Pipe stdout to `jq` freely.
- Output is **JSON by default when piped** (text on a TTY). Force with `--json`,
  `--output ndjson`, or `--output text`. `--quiet`/`-q` prints bare values for
  `$()`/`xargs`; `--fields a,b.c` trims large objects.
- On error in JSON mode, a `{ "error": { code, message, transport, retriable,
hint, input } }` object is printed to **stdout** — branch on `.error`.

## Exit codes

`0` ok · `2` usage · `3` auth · `4` no printer/not selected · `5` timeout
(**retriable**) · `6` transport unavailable (e.g. upload needs LAN) · `7` printer
rejected. Retry on `5`; do not retry on `2`/`3`.

## The three transports (cloud vs LAN)

- **MQTT** (cloud, works anywhere): gcode, status, job control.
- **PPPP** (LAN only): file upload, camera. Needs the printer's IP — run
  `ankerts discover --store` on the same LAN first. Off-LAN upload fails with
  exit 6 and a hint.
- **HTTPS** (cloud): login, account, printer list.

## Common tasks

```sh
# Auth + pick a printer
ankerts login --email "$EMAIL" --password - --country US --save   # password via stdin
ankerts printer list --json | jq -r '.[0].duid'

# Gcode — the response is COMPLETE (multi-frame replies are reassembled)
ankerts gcode M115 --json | jq -r '.fields.FIRMWARE_NAME'
ankerts gcode M900 --json | jq -r '.fields["Advance K"]'   # full value, not truncated
ankerts gcode M9998 --json | jq .recognized                # false for unknown commands

# Status (temps in °C, progress 0–100; bogus third-party-gcode ETA is suppressed)
ankerts printer status --json | jq '{nozzle,bed,job}'

# Upload + start a print (auto-discovers the LAN IP; exit 6 if off-LAN)
ankerts print model.gcode
ankerts printer wait --until printing --timeout 120        # block until it starts (exit 5 on timeout)
```

## Gotchas worth knowing

- `ok` ≠ done. Marlin returns `ok` when a move is _queued_, not finished. For
  "moved physically": `ankerts gcode "G28" --wait-motion` (appends M400).
- `M109`/`M190` block until temperature is reached — their default timeout is
  generous; don't treat the wait as a hang.
- State-mutating gcode (e.g. `M900 K…`, `M92`, `M301`, `M851`) persists in RAM
  until power-cycle. `ankerts state snapshot` before, `ankerts state restore`
  (M501) to revert. The CLI warns on stderr unless `--yes`.
- Long prints: don't hold a process for hours. `ankerts print` returns a handle;
  re-attach later with `ankerts printer wait --until complete` (waits are
  re-derived from server state, so they survive a crash/restart).

For the SDK (importing `@aubron/ankerts` into code) see its README; the CLI is a
thin shell over it, so every CLI capability exists as a typed SDK method.
