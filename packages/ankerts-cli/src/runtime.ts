/**
 * Small helpers shared across command implementations.
 */
import { UsageError } from "@aubron/ankerts";
import type { Context, ParsedArgs } from "./spec.js";

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A required positional, or a structured usage error (exit 2). */
export function requirePositional(ctx: Context, index: number, name: string): string {
  const v = ctx.args.positionals[index];
  if (!v) {
    throw new UsageError({
      message: `missing required argument <${name}>`,
      hint: `See \`ankerts ${ctx.args.positionals.slice(0, index).join(" ")} --help\`.`,
      input: { argument: name },
    });
  }
  return v;
}

/** Resolve a timeout (ms): --timeout (seconds) overrides the fallback. */
export function timeoutMs(ctx: Context, fallbackMs: number): number {
  const t = ctx.globals.timeout;
  return typeof t === "number" && !Number.isNaN(t) ? t * 1000 : fallbackMs;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.values[name] === true;
}

export function flagStr(args: ParsedArgs, name: string): string | undefined {
  const v = args.values[name];
  return typeof v === "string" ? v : undefined;
}
