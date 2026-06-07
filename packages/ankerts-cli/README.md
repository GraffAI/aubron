# @aubron/ankerts-cli

The **`ankerts`** CLI — an agent-first command-line tool for AnkerMake /
eufyMake **M5**-class printers. It's a thin, deterministic shell over the
[`@aubron/ankerts`](../ankerts) SDK: it parses arguments, formats output, maps
typed errors to documented exit codes, and routes data to stdout / logs to
stderr. It contains **no protocol logic**.

## Install

```sh
npm add -g @aubron/ankerts-cli   # provides the `ankerts` binary
```

## Agent-first conventions

- **Structured output.** `--output json|ndjson|text` (alias `--json`). Defaults
  to **json when piped**, text on a TTY. Honors `ANKER_OUTPUT`.
- **Clean streams.** Data → **stdout**; logs, progress, and errors → **stderr**.
  In json mode the error body is emitted to stdout so `… --json | jq '.error'`
  works. No ANSI when piped or `NO_COLOR` is set.
- **`--quiet`/`-q`** for bare values (`$()`/`xargs`), **`--fields a,b.c`** to trim
  large objects.
- **Documented exit codes:** `0` ok · `2` usage · `3` auth · `4` no printer ·
  `5` timeout (retriable) · `6` transport unavailable · `7` printer rejected.
- **`ankerts describe --json`** dumps the entire command tree (every command,
  flag, type, default, exit code, example) for one-call introspection.
- Rich per-command `--help` with the transport used, exit codes, and worked
  examples.

## Examples

```sh
# Log in and store credentials (HTTPS).
ankerts login --email me@example.com --password - --country US --save

# First printer's DUID — clean stdout, no logs intermixed.
ankerts printer list --json | jq -r '.[0].duid'

# Full firmware string (complete multi-frame gcode response).
ankerts gcode M115 --json | jq -r '.fields.FIRMWARE_NAME'

# The bug that started this project — the COMPLETE Linear Advance K value.
ankerts gcode M900 --json | jq -r '.fields["Advance K"]'

# Upload + start over the LAN (auto-discovers IP; exit 6 with a fix if off-LAN).
ankerts print tower.gcode

# Block until the job actually starts (exit 5 on timeout), then cool down later.
ankerts printer wait --until printing --timeout 120
ankerts printer wait --until complete && ankerts gcode "M104 S0"
```

Run `ankerts --help` for the noun groups and the CONCEPTS section explaining the
three transports and the cloud-vs-LAN reachability split, or
`ankerts <command> --help` for details on any command.
