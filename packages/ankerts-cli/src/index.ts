/**
 * @aubron/ankerts-cli — the CLI entrypoint.
 *
 * A thin, deterministic shell over the @aubron/ankerts SDK: it parses arguments,
 * formats output (json/ndjson/text per §3), maps typed SDK errors to documented
 * exit codes, and routes data to stdout / logs+errors to stderr. It contains NO
 * protocol logic.
 */
import { AnkerClient, toAnkerError } from "@aubron/ankerts";
import { allCommands } from "./commands/index.js";
import { extractGlobals, parseCommandArgs } from "./globals.js";
import { renderCommandHelp, renderRootHelp } from "./help.js";
import { Output, resolveMode } from "./output.js";
import type { CommandSpec, Context } from "./spec.js";

/** Match the longest command path that prefixes the leading non-flag tokens. */
function matchCommand(argv: string[]): { spec?: CommandSpec; rest: string[] } {
  const nounTokens: string[] = [];
  for (const tok of argv) {
    if (tok.startsWith("-")) break;
    nounTokens.push(tok);
  }
  let best: CommandSpec | undefined;
  for (const spec of allCommands) {
    if (spec.path.length > nounTokens.length) continue;
    if (spec.path.every((seg, i) => nounTokens[i] === seg)) {
      if (!best || spec.path.length > best.path.length) best = spec;
    }
  }
  if (!best) return { rest: argv };
  // Drop exactly the matched path tokens, preserving the rest (flags + args).
  const rest: string[] = [];
  let dropped = 0;
  for (const tok of argv) {
    if (dropped < best.path.length && !tok.startsWith("-") && tok === best.path[dropped]) {
      dropped++;
      continue;
    }
    rest.push(tok);
  }
  return { spec: best, rest };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const isTty = !!process.stdout.isTTY;
  const noColor = process.env.NO_COLOR !== undefined;

  const { spec, rest } = matchCommand(argv);

  // Parse args against the command's flags (or just globals for help/root).
  let parsed;
  try {
    parsed = parseCommandArgs(rest, spec?.flags ?? []);
  } catch (err) {
    const out = new Output({ mode: isTty ? "text" : "json", isTty, noColor });
    const e = toAnkerError(err);
    out.emitError({ error: { ...e.body(), code: "usage", retriable: false } });
    return 2;
  }
  const globals = extractGlobals(parsed.values);

  const out = new Output({
    mode: resolveMode({
      flag: globals.output,
      json: globals.json,
      env: process.env.ANKER_OUTPUT,
      isTty,
    }),
    quiet: globals.quiet,
    fields: globals.fields,
    isTty,
    noColor,
  });

  // Help: root (no command / bare --help) or command-specific.
  if (!spec) {
    if (argv.length && !globals.help && argv[0] !== "help") {
      out.emitError({
        error: {
          code: "unknown_command",
          message: `unknown command: ${argv.filter((a) => !a.startsWith("-")).join(" ") || "(none)"}`,
          retriable: false,
          hint: "Run `ankerts --help`, or `ankerts describe --json` to introspect the full tree.",
        },
      });
      return 2;
    }
    process.stdout.write(`${renderRootHelp(allCommands)}\n`);
    return 0;
  }
  if (globals.help) {
    process.stdout.write(`${renderCommandHelp(spec)}\n`);
    return 0;
  }

  const ctx: Context = {
    out,
    args: parsed,
    globals,
    client: () =>
      AnkerClient.fromStoredConfig(undefined, {
        log: (m) => out.log(m),
        printer: globals.printer,
        insecure: globals.insecure,
      }),
    readStdin,
  };

  try {
    await spec.run(ctx);
    return 0;
  } catch (err) {
    const e = toAnkerError(err);
    out.emitError(e.toJSON());
    return e.exitCode;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
