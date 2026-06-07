/**
 * `ankerts skills install` — copy the bundled `ankerts` Agent Skill into a
 * skills directory so an agent (Claude Code, and any SKILL.md-compatible tool)
 * learns to drive ankerts. Explicit and on-demand — never a postinstall hook.
 */
import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "@aubron/ankerts";
import { defineCommand, type CommandSpec } from "../spec.js";
import { flagBool, flagStr } from "../runtime.js";

const SKILL_NAME = "ankerts";

/** Resolve the skill bundled alongside the built CLI (`dist/` → `../skills`). */
function bundledSkillDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", SKILL_NAME);
}

const install: CommandSpec = defineCommand({
  path: ["skills", "install"],
  summary: "Install the bundled `ankerts` Agent Skill into a skills directory.",
  description:
    "Copies the SKILL.md that ships inside this package into a skills directory so an " +
    "agent learns how to drive ankerts. Defaults to the project's .claude/skills/; " +
    "use --global for ~/.claude/skills, or --dir to target any directory (works for any " +
    "SKILL.md-compatible agent). Explicit and idempotent — re-run with --force to overwrite.",
  transport: "none",
  flags: [
    {
      name: "global",
      type: "boolean",
      description: "Install into ~/.claude/skills instead of the project.",
    },
    {
      name: "dir",
      type: "string",
      description: "Target skills directory (overrides --global/project).",
    },
    { name: "force", type: "boolean", description: "Overwrite an existing install." },
  ],
  exitCodes: [0, 1, 2],
  examples: [
    { description: "Install into the current project", cmd: "ankerts skills install" },
    { description: "Install for all projects", cmd: "ankerts skills install --global" },
    {
      description: "Install for another agent",
      cmd: "ankerts skills install --dir ~/.codex/skills",
    },
  ],
  run(ctx) {
    const src = bundledSkillDir();
    if (!existsSync(src)) {
      throw new UsageError({
        code: "skill_not_bundled",
        message: "Bundled skill not found next to the CLI",
        hint: "Reinstall @aubron/ankerts-cli — the published package ships skills/ankerts/SKILL.md.",
      });
    }

    const dir = flagStr(ctx.args, "dir");
    const skillsDir = dir
      ? resolve(dir)
      : flagBool(ctx.args, "global")
        ? join(homedir(), ".claude", "skills")
        : resolve(".claude", "skills");

    const dest = join(skillsDir, SKILL_NAME);
    if (existsSync(dest) && !flagBool(ctx.args, "force")) {
      throw new UsageError({
        code: "skill_exists",
        message: `Skill already installed at ${dest}`,
        hint: "Re-run with --force to overwrite.",
        input: { dest },
      });
    }

    if (ctx.globals.dryRun) {
      ctx.out.emit({ dryRun: true, action: "skills install", from: src, to: dest });
      return;
    }

    cpSync(src, dest, { recursive: true });
    ctx.out.log(`installed ${SKILL_NAME} skill → ${dest}`);
    ctx.out.emit({ installed: dest, skill: SKILL_NAME });
  },
});

export const skillsCommands = [install];
