/**
 * Build the root `.claude-plugin/marketplace.json` from the skill packages in
 * the monorepo. Sources are hybrid per the factory's needs (brief decision):
 * `git-subdir` by default (no publish step — points at the package folder), or
 * `npm` for released packages (version-pinned). A package opts into npm via
 * `"aubronSkill": { "source": "npm" }` in its package.json.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export type SkillSource =
  | { source: "git-subdir"; url: string; path: string }
  | { source: "npm"; package: string; version: string };

export interface SkillPackageInfo {
  /** Folder name under packages/ (e.g. `skill-factory`). */
  dirName: string;
  /** Plugin name from .claude-plugin/plugin.json (the install id). */
  pluginName: string;
  /** npm package name from package.json. */
  npmName: string;
  version: string;
  description?: string;
  preferredSource: "git-subdir" | "npm";
}

export interface MarketplaceOptions {
  name?: string;
  owner?: { name: string; email?: string };
  /** Git URL used for git-subdir sources. */
  repoUrl?: string;
}

const DEFAULTS = {
  name: "aubron",
  owner: { name: "Aubron Wood" },
  repoUrl: "https://github.com/GraffAI/aubron.git",
};

/** Scan `packagesDir` for skill packages (those with a plugin manifest). */
export function discoverSkillPackages(packagesDir: string): SkillPackageInfo[] {
  if (!existsSync(packagesDir)) return [];
  const infos: SkillPackageInfo[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, ".claude-plugin", "plugin.json");
    const pkgPath = join(dir, "package.json");
    if (!existsSync(manifestPath) || !existsSync(pkgPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      version?: string;
      description?: string;
      aubronSkill?: { source?: "git-subdir" | "npm" };
    };
    infos.push({
      dirName: basename(dir),
      pluginName: manifest.name ?? entry.name,
      npmName: pkg.name ?? `@aubron/${entry.name}`,
      version: pkg.version ?? "0.0.0",
      description: pkg.description,
      preferredSource: pkg.aubronSkill?.source ?? "git-subdir",
    });
  }
  return infos.sort((a, b) => a.pluginName.localeCompare(b.pluginName));
}

function sourceFor(info: SkillPackageInfo, repoUrl: string): SkillSource {
  if (info.preferredSource === "npm") {
    return { source: "npm", package: info.npmName, version: `^${info.version}` };
  }
  return { source: "git-subdir", url: repoUrl, path: `packages/${info.dirName}` };
}

/** Build the marketplace.json object (pure). */
export function buildMarketplace(
  infos: SkillPackageInfo[],
  opts: MarketplaceOptions = {},
): unknown {
  const name = opts.name ?? DEFAULTS.name;
  const owner = opts.owner ?? DEFAULTS.owner;
  const repoUrl = opts.repoUrl ?? DEFAULTS.repoUrl;
  return {
    $schema: "https://json.schemastore.org/claude-code-plugin-marketplace.json",
    name,
    owner,
    description: "Claude Agent Skills published from the @aubron package factory.",
    plugins: infos.map((info) => ({
      name: info.pluginName,
      source: sourceFor(info, repoUrl),
      ...(info.description ? { description: info.description } : {}),
      version: info.version,
    })),
  };
}

/** Serialize the marketplace to the canonical on-disk form. */
export function renderMarketplace(marketplace: unknown): string {
  return `${JSON.stringify(marketplace, null, 2)}\n`;
}
