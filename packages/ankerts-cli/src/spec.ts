/**
 * Command specification types. Every command is described by one declarative
 * spec — summary, long description (with transport), flags, args, exit codes,
 * and worked examples. Help text, `describe --json` introspection, and argument
 * parsing all derive from these specs, so the documentation an agent reads is
 * generated from the same source of truth that runs the command (brief §3).
 */
import type { Output } from "./output.js";
import type { AnkerClient } from "@aubron/ankerts";

export type FlagType = "string" | "boolean" | "number";

export interface FlagSpec {
  name: string;
  type: FlagType;
  short?: string;
  default?: string | boolean | number;
  description: string;
  /** Allow repeating to build an array (e.g. multiple gcode args). */
  multiple?: boolean;
}

export interface ArgSpec {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface ExampleSpec {
  cmd: string;
  description?: string;
  output?: string;
}

export type TransportTag = "mqtt" | "pppp" | "https" | "none";

export interface ParsedArgs {
  values: Record<string, string | boolean | number | string[]>;
  positionals: string[];
}

export interface Context {
  out: Output;
  args: ParsedArgs;
  /** Global flags shared by every command. */
  globals: GlobalFlags;
  /** Lazily build the SDK client from stored config (logger → stderr). */
  client: () => AnkerClient;
  /** Read all of stdin as text (for `gcode -` and batch input). */
  readStdin: () => Promise<string>;
}

export interface GlobalFlags {
  output?: string;
  json?: boolean;
  quiet?: boolean;
  fields?: string[];
  dryRun?: boolean;
  yes?: boolean;
  printer?: string;
  timeout?: number;
  noInput?: boolean;
  reveal?: boolean;
  insecure?: boolean;
  help?: boolean;
}

export interface CommandSpec {
  /** Noun→verb path, e.g. `["printer", "status"]`. */
  path: string[];
  summary: string;
  description: string;
  transport: TransportTag;
  flags: FlagSpec[];
  args: ArgSpec[];
  exitCodes: number[];
  examples: ExampleSpec[];
  run: (ctx: Context) => Promise<void> | void;
}

export type CommandSpecInput = Partial<CommandSpec> & Pick<CommandSpec, "path" | "summary" | "run">;

/** Fill defaults so every command has a complete, introspectable spec. */
export function defineCommand(input: CommandSpecInput): CommandSpec {
  return {
    description: input.summary,
    transport: "none",
    flags: [],
    args: [],
    exitCodes: [0, 1, 2],
    examples: [],
    ...input,
  };
}
