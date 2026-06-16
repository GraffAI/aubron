/**
 * gen.ts — the package factory's one script.
 *
 *   pnpm new <name> --type <lib|cli|skill> [--description "..."]
 *   pnpm eject <name> [--dest <dir>] [--push] [--private]
 *
 * Run via tsx. No interactive prompts (CI-friendly); all inputs are flags/args.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  buildMarketplace,
  discoverSkillPackages,
  renderMarketplace,
} from "../packages/skill-tools/src/marketplace.js";

const SCOPE = "@aubron";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(ROOT, "scripts", "templates");
const PACKAGES = join(ROOT, "packages");
const APPS = join(ROOT, "apps");

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function render(text: string, ctx: Record<string, string>): string {
  return text.replace(/__[A-Z]+__/g, (token) => (token in ctx ? ctx[token]! : token));
}

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function writeJson(path: string, value: Json): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge `source` onto `target` (objects recurse, everything else wins). */
function deepMerge(target: Json, source: Json): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] = isObject(existing) && isObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

/** Recursively copy a directory, rendering text files and skipping `skip`. */
function copyTree(
  from: string,
  to: string,
  ctx: Record<string, string>,
  skip: (name: string) => boolean = () => false,
): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyTree(src, dest, ctx, skip);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, render(readFileSync(src, "utf8"), ctx));
    }
  }
}

/** Minimal reader for the `catalog:` block in pnpm-workspace.yaml. */
function readCatalog(): Record<string, string> {
  const lines = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/);
  const catalog: Record<string, string> = {};
  let inCatalog = false;
  for (const line of lines) {
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (!inCatalog) continue;
    if (/^\S/.test(line)) break; // dedented out of the block
    const match = /^\s+"?([^":\s]+)"?:\s*(\S+)\s*$/.exec(line);
    if (match) catalog[match[1]!] = match[2]!;
  }
  return catalog;
}

function run(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------

function cmdNew(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      type: { type: "string" },
      description: { type: "string" },
      bin: { type: "string" },
    },
  });

  const name = positionals[0];
  if (!name) fail("usage: pnpm new <name> --type <lib|cli> [--description ...]");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
    fail(`invalid name "${name}" — use kebab-case, no scope`);

  const type = values.type ?? "lib";
  if (type !== "lib" && type !== "cli" && type !== "skill" && type !== "app")
    fail(`--type must be "lib", "cli", "skill", or "app" (got "${type}")`);

  // Apps are deployed, not published: they live under apps/, are private, get no
  // changeset, and use a name (not an @aubron-scoped package) — handle them apart.
  if (type === "app") return cmdNewApp(name, values.description);

  const pkgDir = join(PACKAGES, name);
  if (existsSync(pkgDir)) fail(`packages/${name} already exists`);

  const pkgName = `${SCOPE}/${name}`;
  const ctx: Record<string, string> = {
    __NAME__: name,
    __PKG__: pkgName,
    __DESCRIPTION__: values.description ?? `The ${pkgName} package.`,
    __BIN__: values.bin ?? name,
    __YEAR__: String(new Date().getFullYear()),
  };

  // Skills are documentation packages (a Claude plugin bundling a SKILL.md),
  // not TypeScript build targets — they take a different path entirely.
  if (type === "skill") return cmdNewSkill(name, pkgName, pkgDir, ctx);

  // 1. base template (everything except package.json, handled separately).
  mkdirSync(pkgDir, { recursive: true });
  copyTree(join(TEMPLATES, "package"), pkgDir, ctx, (n) => n === "package.json");

  // 2. build package.json: base, then deep-merge the type overlay's fragment.
  let pkg = JSON.parse(
    render(readFileSync(join(TEMPLATES, "package", "package.json"), "utf8"), ctx),
  ) as Json;

  // 3. overlay type-specific files (package.json fragment is deep-merged).
  const typeDir = join(TEMPLATES, "types", type);
  if (existsSync(typeDir)) {
    for (const entry of walk(typeDir)) {
      const rel = entry.slice(typeDir.length + 1);
      if (rel === ".gitkeep") continue;
      if (rel === "package.json") {
        const fragment = JSON.parse(render(readFileSync(entry, "utf8"), ctx)) as Json;
        pkg = deepMerge(pkg, fragment);
      } else {
        const dest = join(pkgDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, render(readFileSync(entry, "utf8"), ctx));
      }
    }
  }
  writeJson(join(pkgDir, "package.json"), pkg);

  // 4. starter changeset (minor bump → first publish is automatic).
  writeFileSync(
    join(ROOT, ".changeset", `${name}-init.md`),
    `---\n"${pkgName}": minor\n---\n\nInitial release of ${pkgName}.\n`,
  );

  // 5. link the new workspace.
  console.log(`→ pnpm install`);
  run("pnpm", ["install"], ROOT);

  // 6. next steps.
  console.log(`\n✔ Created packages/${name} (${pkgName}, type: ${type})`);
  console.log(`\nNext:`);
  console.log(`  pnpm --filter ${pkgName} build`);
  console.log(`  pnpm --filter ${pkgName} test`);
  console.log(`  # edit packages/${name}/src/index.ts, then commit`);
}

/** Regenerate the root `.claude-plugin/marketplace.json` from skill packages. */
function regenerateMarketplace(): void {
  const repo = readJson(join(ROOT, "package.json")).repository;
  const repoUrl =
    typeof repo === "string"
      ? `${repo.replace(/^github:/, "https://github.com/")}${repo.endsWith(".git") ? "" : ".git"}`
      : undefined;
  const infos = discoverSkillPackages(PACKAGES);
  const content = renderMarketplace(buildMarketplace(infos, repoUrl ? { repoUrl } : {}));
  mkdirSync(join(ROOT, ".claude-plugin"), { recursive: true });
  writeFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), content);
  console.log(`→ updated .claude-plugin/marketplace.json (${infos.length} skills)`);
}

/** Scaffold a Claude Agent Skill package (SKILL.md + plugin manifest). */
function cmdNewSkill(
  name: string,
  pkgName: string,
  pkgDir: string,
  ctx: Record<string, string>,
): void {
  const skillTemplate = join(TEMPLATES, "skill");

  // Copy the template tree, except SKILL.md (which lands under skills/<name>/).
  mkdirSync(pkgDir, { recursive: true });
  copyTree(skillTemplate, pkgDir, ctx, (n) => n === "SKILL.md");

  // Place the skill at skills/<name>/SKILL.md (the plugin's default skills dir).
  const skillDir = join(pkgDir, "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    render(readFileSync(join(skillTemplate, "SKILL.md"), "utf8"), ctx),
  );

  // Starter changeset (minor bump → first publish is automatic).
  writeFileSync(
    join(ROOT, ".changeset", `${name}-init.md`),
    `---\n"${pkgName}": minor\n---\n\nInitial release of ${pkgName}.\n`,
  );

  regenerateMarketplace();

  console.log(`→ pnpm install`);
  run("pnpm", ["install"], ROOT);

  console.log(`\n✔ Created packages/${name} (${pkgName}, type: skill)`);
  console.log(`\nNext:`);
  console.log(`  # edit packages/${name}/skills/${name}/SKILL.md`);
  console.log(`  pnpm --filter ${pkgName} test    # validate the skill`);
  console.log(`  # install it: claude plugin marketplace add GraffAI/aubron`);
  console.log(`  #             claude plugin install ${name}@aubron`);
}

/**
 * Scaffold an app (a deployed-not-published workspace under apps/). Unlike a
 * package it's private, gets no changeset, and is named plainly (no @aubron
 * scope) since it never hits npm — CI deploys it to Vercel instead.
 */
function cmdNewApp(name: string, description?: string): void {
  const appDir = join(APPS, name);
  if (existsSync(appDir)) fail(`apps/${name} already exists`);

  const ctx: Record<string, string> = {
    __NAME__: name,
    __DESCRIPTION__: description ?? `The ${name} app.`,
    __YEAR__: String(new Date().getFullYear()),
  };

  mkdirSync(appDir, { recursive: true });
  copyTree(join(TEMPLATES, "app"), appDir, ctx);

  // No changeset: apps are deployed by CI, never released to npm.
  console.log(`→ pnpm install`);
  run("pnpm", ["install"], ROOT);

  console.log(`\n✔ Created apps/${name} (type: app)`);
  console.log(`\nNext:`);
  console.log(`  pnpm --filter ${name} dev`);
  console.log(`  # provision the Vercel project once (see README "Apps"), then`);
  console.log(`  # CI deploys it on every push to main.`);
}

/** Yield every file path under `dir`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// eject
// ---------------------------------------------------------------------------

function resolveWorkspaceVersion(depName: string): string {
  // @aubron/<x> lives at packages/<x>.
  const local = depName.startsWith(`${SCOPE}/`)
    ? join(PACKAGES, depName.slice(SCOPE.length + 1))
    : null;
  if (!local || !existsSync(join(local, "package.json")))
    fail(`cannot resolve workspace dependency ${depName}`);
  const version = (readJson(join(local!, "package.json")).version as string) ?? "0.0.0";
  return `^${version}`;
}

function rewriteDeps(deps: Json | undefined, catalog: Record<string, string>): Json | undefined {
  if (!deps) return deps;
  const out: Json = {};
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== "string") {
      out[name] = spec;
    } else if (spec.startsWith("workspace:")) {
      out[name] = resolveWorkspaceVersion(name);
    } else if (spec === "catalog:" || spec.startsWith("catalog:")) {
      const version = catalog[name];
      if (!version) fail(`no catalog entry for ${name}`);
      out[name] = version;
    } else {
      out[name] = spec;
    }
  }
  return out;
}

function cmdEject(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dest: { type: "string" },
      push: { type: "boolean" },
      private: { type: "boolean" },
    },
  });

  const name = positionals[0];
  if (!name) fail("usage: pnpm eject <name> [--dest <dir>] [--push] [--private]");

  const pkgDir = join(PACKAGES, name);
  if (!existsSync(pkgDir)) fail(`packages/${name} does not exist`);

  // Skill packages are documentation plugins (no TS build/typecheck), so their
  // standalone scripts + CI differ from a code package's.
  const isSkill = existsSync(join(pkgDir, ".claude-plugin", "plugin.json"));

  const dest = values.dest ? resolve(values.dest) : resolve(ROOT, "..", name);
  if (existsSync(dest) && readdirSync(dest).length > 0)
    fail(`destination ${dest} exists and is not empty`);

  const catalog = readCatalog();
  const rootPkg = readJson(join(ROOT, "package.json"));
  const rootDev = (rootPkg.devDependencies as Json) ?? {};
  const src = readJson(join(pkgDir, "package.json"));

  // 1. rewrite every workspace:/catalog: specifier to a concrete semver range.
  const out: Json = { ...src };
  out.dependencies = rewriteDeps(src.dependencies as Json | undefined, catalog);
  out.peerDependencies = rewriteDeps(src.peerDependencies as Json | undefined, catalog);
  const devDeps = (rewriteDeps(src.devDependencies as Json | undefined, catalog) ?? {}) as Json;

  // 2. add the standalone-only toolchain (no monorepo root to hoist from).
  const pin = (dep: string): string => (rootDev[dep] as string) ?? catalog[dep] ?? "latest";
  devDeps["prettier"] = catalog["prettier"] ?? pin("prettier");
  devDeps["lefthook"] = pin("lefthook");
  devDeps["@changesets/cli"] = pin("@changesets/cli");
  devDeps["@changesets/changelog-github"] = pin("@changesets/changelog-github");
  out.devDependencies = sortKeys(devDeps);

  // 3. standalone scripts (format/changeset/hooks) on top of the package's own.
  out.scripts = {
    ...(src.scripts as Json),
    format: "prettier --write .",
    "format:check": "prettier --check .",
    changeset: "changeset",
    // Skills have no build step; code packages build before publishing.
    release: isSkill ? "changeset publish" : "pnpm build && changeset publish",
    prepare: "lefthook install",
  };

  for (const empty of ["dependencies", "peerDependencies"] as const) {
    if (out[empty] && Object.keys(out[empty] as Json).length === 0) delete out[empty];
  }

  // Pin the package manager so the standalone repo (and its CI) uses the same
  // pnpm as the monorepo. The build-script allowlist that pnpm 11 needs lives in
  // the standalone pnpm-workspace.yaml (stamped from templates), not here.
  if (rootPkg.packageManager) out.packageManager = rootPkg.packageManager as string;
  if (values.private) out.private = true;

  // Repoint `repository` at the standalone repo (no monorepo `directory`), so
  // npm provenance validates against the ejected package's own CI.
  out.repository = { type: "git", url: `git+https://github.com/GraffAI/${name}.git` };

  // 4. flatten package contents (configs copy verbatim — they reference
  //    @aubron/* by name, which now resolves from npm) and write package.json.
  mkdirSync(dest, { recursive: true });
  copyTree(
    pkgDir,
    dest,
    {},
    (n) => n === "package.json" || n === "node_modules" || n === "dist" || n === ".turbo",
  );
  writeJson(join(dest, "package.json"), out);

  // 5. stamp standalone root files.
  const ctx: Record<string, string> = {
    __NAME__: name,
    __PKG__: (src.name as string) ?? `${SCOPE}/${name}`,
    __DESCRIPTION__: (src.description as string) ?? "",
    __YEAR__: String(new Date().getFullYear()),
  };
  copyTree(join(TEMPLATES, "standalone"), dest, ctx);

  // 5b. a skill has no build/typecheck — drop those CI steps so the ejected
  //     repo's workflows match the scripts it actually exposes.
  if (isSkill) {
    for (const wf of ["ci.yml", "release.yml"]) {
      const wfPath = join(dest, ".github", "workflows", wf);
      if (!existsSync(wfPath)) continue;
      const filtered = readFileSync(wfPath, "utf8")
        .split("\n")
        .filter((line) => !/^\s*- run: pnpm (build|typecheck)\s*$/.test(line))
        .join("\n");
      writeFileSync(wfPath, filtered);
    }
  }

  // 6. init git.
  run("git", ["init", "-q", "-b", "main"], dest);
  run("git", ["add", "-A"], dest);
  run("git", ["commit", "-q", "-m", "Initial commit"], dest);

  // 7. optional push to GitHub.
  if (values.push) {
    const args = ["repo", "create", `GraffAI/${name}`, `--source=${dest}`, "--push"];
    args.push(values.private ? "--private" : "--public");
    run("gh", args, dest);
  }

  console.log(`\n✔ Ejected ${ctx.__PKG__} → ${dest}`);
  console.log(`\nNext:`);
  console.log(`  cd ${dest} && pnpm install`);
  console.log(`  # set up npm Trusted Publishing for the repo, or add NPM_TOKEN`);
  if (!values.push) console.log(`  # then create a GitHub repo (or re-run eject with --push)`);
}

function sortKeys(obj: Json): Json {
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]]),
  );
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

const [sub, ...rest] = process.argv.slice(2);
switch (sub) {
  case "new":
    cmdNew(rest);
    break;
  case "eject":
    cmdEject(rest);
    break;
  default:
    fail(`unknown subcommand "${sub ?? ""}" — expected "new" or "eject"`);
}
