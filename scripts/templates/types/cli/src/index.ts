import { parseArgs } from "node:util";

/**
 * Core command logic, exported for testing. This is starter code — replace it
 * with your own command.
 */
export function greet(name = "world", shout = false): string {
  const message = `Hello, ${name}!`;
  return shout ? message.toUpperCase() : message;
}

/** Parse argv (without the leading `node script` entries) and produce output. */
export function run(argv: string[]): string {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      shout: { type: "boolean", short: "s", default: false },
    },
    allowPositionals: true,
  });
  return greet(positionals[0], values.shout);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(run(process.argv.slice(2)));
}
