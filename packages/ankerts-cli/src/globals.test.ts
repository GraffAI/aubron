import { describe, expect, it } from "vitest";
import { buildDescribeTree } from "./describe.js";
import { allCommands } from "./commands/index.js";
import { extractGlobals, parseCommandArgs } from "./globals.js";

describe("parseCommandArgs + extractGlobals", () => {
  it("parses global flags and command flags together", () => {
    const flags = [{ name: "watch", type: "boolean" as const, description: "" }];
    const parsed = parseCommandArgs(["--json", "-q", "--fields", "a,b.c", "--watch"], flags);
    const g = extractGlobals(parsed.values);
    expect(g.json).toBe(true);
    expect(g.quiet).toBe(true);
    expect(g.fields).toEqual(["a", "b.c"]);
    expect(parsed.values.watch).toBe(true);
  });

  it("collects positionals and converts numeric timeout", () => {
    const parsed = parseCommandArgs(["M115", "M105", "--timeout", "30"], []);
    expect(parsed.positionals).toEqual(["M115", "M105"]);
    expect(extractGlobals(parsed.values).timeout).toBe(30);
  });
});

describe("describe tree", () => {
  it("covers every command and the documented surface", () => {
    const tree = buildDescribeTree(allCommands) as {
      commands: { command: string; exitCodes: number[]; examples: unknown[] }[];
      exitCodes: Record<string, string>;
      transports: Record<string, unknown>;
    };
    const paths = tree.commands.map((c) => c.command);
    expect(paths).toContain("gcode");
    expect(paths).toContain("printer wait");
    expect(paths).toContain("print");
    // every command documents exit codes
    expect(tree.commands.every((c) => c.exitCodes.length > 0)).toBe(true);
    // the full exit-code contract is present
    expect(Object.keys(tree.exitCodes)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(Object.keys(tree.transports)).toEqual(["mqtt", "pppp", "https"]);
  });

  it("every command with a printer transport carries at least one example", () => {
    const tree = buildDescribeTree(allCommands) as {
      commands: { command: string; transport: string; examples: unknown[] }[];
    };
    for (const c of tree.commands) {
      expect(c.examples.length, `${c.command} should have examples`).toBeGreaterThan(0);
    }
  });
});
