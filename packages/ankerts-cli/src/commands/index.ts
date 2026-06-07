/**
 * Command registry — aggregates every command spec and adds `describe`.
 */
import { buildDescribeTree } from "../describe.js";
import { defineCommand, type CommandSpec } from "../spec.js";
import { authCommands } from "./auth.js";
import { gcodeCommands } from "./gcode.js";
import { jobCommands } from "./jobs.js";
import { printerCommands } from "./printer.js";
import { skillsCommands } from "./skills.js";

const baseCommands: CommandSpec[] = [
  ...authCommands,
  ...printerCommands,
  ...gcodeCommands,
  ...jobCommands,
  ...skillsCommands,
];

const describe: CommandSpec = defineCommand({
  path: ["describe"],
  summary: "Print the full command tree as JSON (machine-readable introspection).",
  description:
    "Emits every command, flag, type, default, exit code, and example as one JSON " +
    "document — so an agent can map the tool's entire surface in a single call instead " +
    "of crawling --help pages.",
  transport: "none",
  exitCodes: [0, 1],
  examples: [
    {
      description: "List every command path",
      cmd: "ankerts describe --json | jq -r '.commands[].command'",
    },
  ],
  run(ctx) {
    ctx.out.emit(buildDescribeTree(allCommands));
  },
});

export const allCommands: CommandSpec[] = [...baseCommands, describe];
