/**
 * Validation for Claude Agent Skill packages (SKILL.md + a plugin manifest),
 * following the Agent Skills open standard (agentskills.io) and Claude Code's
 * plugin format. Pure checks over already-read content are unit-testable; the
 * filesystem walk is a thin wrapper.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asString, parseFrontmatter } from "./frontmatter.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Claude combines description + when_to_use into the trigger context; keep them
// well within the documented ceiling so the skill stays discoverable.
const TRIGGER_SOFT_LIMIT = 1024;

const merge = (...results: ValidationResult[]): ValidationResult => ({
  ok: results.every((r) => r.ok),
  errors: results.flatMap((r) => r.errors),
  warnings: results.flatMap((r) => r.warnings),
});

/** Validate the frontmatter of a single SKILL.md document. */
export function validateSkillMd(content: string, label = "SKILL.md"): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { data, body } = parseFrontmatter(content);

  if (Object.keys(data).length === 0) {
    errors.push(`${label}: missing YAML frontmatter (expected a leading \`---\` block)`);
    return { ok: false, errors, warnings };
  }

  const name = asString(data.name);
  if (!name) {
    warnings.push(`${label}: no \`name\` — Claude will fall back to the directory name`);
  } else if (!KEBAB.test(name)) {
    errors.push(`${label}: \`name\` "${name}" must be kebab-case (a-z, 0-9, hyphens)`);
  }

  const description = asString(data.description);
  if (!description || description.trim() === "") {
    errors.push(
      `${label}: \`description\` is required (it's how Claude decides to invoke the skill)`,
    );
  } else {
    const trigger = description.length + (asString(data.when_to_use)?.length ?? 0);
    if (trigger > TRIGGER_SOFT_LIMIT) {
      warnings.push(
        `${label}: description + when_to_use is ${trigger} chars (keep under ~${TRIGGER_SOFT_LIMIT} for reliable triggering)`,
      );
    }
  }

  if (body.trim().length === 0) {
    warnings.push(`${label}: body is empty — a skill should contain instructions`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Validate a parsed `.claude-plugin/plugin.json` object. */
export function validatePluginJson(obj: unknown, label = "plugin.json"): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof obj !== "object" || obj === null) {
    return { ok: false, errors: [`${label}: not a JSON object`], warnings };
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.name !== "string" || !KEBAB.test(o.name)) {
    errors.push(`${label}: \`name\` is required and must be kebab-case`);
  }
  if (typeof o.description !== "string" || o.description.trim() === "") {
    warnings.push(`${label}: \`description\` is recommended (shown in the plugin manager)`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate a skill package directory: its `.claude-plugin/plugin.json` and every
 * `skills/<name>/SKILL.md` it bundles.
 */
export function validateSkillPackage(dir: string): ValidationResult {
  const errors: string[] = [];
  const results: ValidationResult[] = [];

  const manifestPath = join(dir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    errors.push(`${dir}: missing .claude-plugin/plugin.json`);
  } else {
    try {
      results.push(validatePluginJson(JSON.parse(readFileSync(manifestPath, "utf8"))));
    } catch (err) {
      errors.push(`plugin.json: invalid JSON — ${(err as Error).message}`);
    }
  }

  const skillsDir = join(dir, "skills");
  if (!existsSync(skillsDir)) {
    errors.push(`${dir}: missing skills/ directory`);
  } else {
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    if (skillDirs.length === 0) errors.push(`${skillsDir}: contains no skills`);
    for (const sd of skillDirs) {
      const skillMd = join(skillsDir, sd.name, "SKILL.md");
      if (!existsSync(skillMd)) {
        errors.push(`skills/${sd.name}: missing SKILL.md`);
        continue;
      }
      results.push(validateSkillMd(readFileSync(skillMd, "utf8"), `skills/${sd.name}/SKILL.md`));
    }
  }

  return merge({ ok: errors.length === 0, errors, warnings: [] }, ...results);
}
