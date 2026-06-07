/**
 * `aubron-skill` CLI — validate a skill package and keep the marketplace in sync.
 *
 *   aubron-skill validate [dir]            # validate a skill package (default cwd)
 *   aubron-skill sync-marketplace [--check] # regenerate the root marketplace.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  buildMarketplace,
  discoverSkillPackages,
  findRepoRoot,
  renderMarketplace,
  validateSkillPackage,
} from "./index.js";

function cmdValidate(argv: string[]): number {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true });
  const dir = resolve(positionals[0] ?? process.cwd());
  const result = validateSkillPackage(dir);
  for (const w of result.warnings) console.error(`⚠ ${w}`);
  for (const e of result.errors) console.error(`✖ ${e}`);
  if (result.ok) {
    console.log(`✔ skill package valid: ${dir}`);
    return 0;
  }
  return 1;
}

function readRepoUrl(root: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      repository?: string | { url?: string };
    };
    const repo = pkg.repository;
    if (typeof repo === "string") {
      return `${repo.replace(/^github:/, "https://github.com/")}${repo.endsWith(".git") ? "" : ".git"}`;
    }
    if (repo?.url) return repo.url;
  } catch {
    /* fall back to default */
  }
  return undefined;
}

function cmdSyncMarketplace(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { check: { type: "boolean" } } });
  const root = findRepoRoot(process.cwd());
  const infos = discoverSkillPackages(join(root, "packages"));
  const repoUrl = readRepoUrl(root);
  const content = renderMarketplace(buildMarketplace(infos, repoUrl ? { repoUrl } : {}));

  const outPath = join(root, ".claude-plugin", "marketplace.json");
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";

  if (values.check) {
    if (existing !== content) {
      console.error("✖ marketplace.json is out of date — run `aubron-skill sync-marketplace`");
      return 1;
    }
    console.log(`✔ marketplace.json is up to date (${infos.length} skills)`);
    return 0;
  }

  writeFileSync(outPath, content);
  console.log(`✔ wrote ${outPath} (${infos.length} skills)`);
  return 0;
}

function main(argv: string[]): number {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "validate":
      return cmdValidate(rest);
    case "sync-marketplace":
      return cmdSyncMarketplace(rest);
    case undefined:
    case "--help":
    case "-h":
      console.log("usage: aubron-skill <validate [dir] | sync-marketplace [--check]>");
      return 0;
    default:
      console.error(`unknown subcommand "${sub}"`);
      console.error("usage: aubron-skill <validate [dir] | sync-marketplace [--check]>");
      return 2;
  }
}

process.exit(main(process.argv.slice(2)));
