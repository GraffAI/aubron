# aubron

A package factory for publishing TypeScript packages to npm under the
`@aubron/*` scope. pnpm + Turborepo monorepo with one source of truth for every
standard (TS / ESLint / Prettier / tsup), shipped as published config packages.

The trick: packages reference shared config **by package name** (e.g.
`"extends": "@aubron/tsconfig/cli.json"`). That string resolves via the
workspace symlink inside the monorepo and via `node_modules` in a standalone
repo — so an ejected package needs **zero config rewriting**.

## Layout

```
packages/
  tsconfig/        @aubron/tsconfig        — shared tsconfigs (base/lib/cli)
  eslint-config/   @aubron/eslint-config   — flat ESLint config
  prettier-config/ @aubron/prettier-config — Prettier config
  tsup-config/     @aubron/tsup-config     — tsup build preset
  skill-tools/     @aubron/skill-tools     — validate + release Claude skills
  skill-factory/   @aubron/skill-factory   — meta-skill: how to author/ship skills
  ankerts/         @aubron/ankerts         — AnkerMake/eufyMake M5 SDK
  ankerts-cli/     @aubron/ankerts-cli     — `ankerts` CLI (thin shell over the SDK)
apps/
  transit/         Puget Sound transit — bespoke WebGL live map (deployed, not published)
scripts/gen.ts     — `new` + `eject` commands; templates/ alongside
.claude-plugin/marketplace.json — generated catalog of the skill packages
```

`packages/*` are **published to npm**; `apps/*` are **deployed to the internet**
by CI (Vercel) and never published. See "Apps" below.

## Create a package

```sh
pnpm new <name> --type <lib|cli|skill|app> [--description "..."]
pnpm new color --type lib
pnpm new todo --type cli --description "A todo CLI"
pnpm new my-skill --type skill --description "What it does + when to use it"
pnpm new dashboard --type app --description "An internal dashboard"
```

`--type skill` scaffolds a Claude Agent Skill (a `SKILL.md` + a plugin manifest)
and wires it into the `aubron` plugin marketplace. See the `skill-factory` skill
for the full author → validate → release runbook.

This scaffolds `packages/<name>`, fully configured and publish-eligible, drops a
starter changeset, and runs `pnpm install` to link it. Then:

```sh
pnpm --filter @aubron/<name> build
pnpm --filter @aubron/<name> test
```

## Day-to-day

```sh
pnpm turbo run build lint typecheck test   # everything, cached
pnpm format                                 # Prettier write
pnpm format:check                           # Prettier check
```

## Release flow (CI-first)

The only local action is declaring intent:

1. `pnpm changeset` — pick packages + bump type, write a summary, commit the file.
2. Open a PR and merge it. CI is required to have a changeset for any
   `packages/**` change.
3. On merge to `main`, the release workflow opens a **Version Packages** PR that
   bumps versions and updates changelogs.
4. Merge that PR → CI builds and runs `changeset publish` → packages go to npm
   with provenance.

## Eject a package to its own repo

```sh
pnpm eject <name> [--dest <dir>] [--push] [--private]
pnpm eject ankerts --push
```

Eject is **copy-out only** (it never mutates the source package). It rewrites
every `workspace:*` / `catalog:` specifier to a concrete semver range (mirroring
what pnpm does on publish), flattens the package to the destination root, copies
the config files **verbatim** (their `@aubron/*` references now resolve from
npm), and stamps the standalone toolchain (CI, release, Changesets, Dependabot,
Lefthook, `CLAUDE.md`). The new repo inherits identical standards.

> Standalone install/build requires the `@aubron/*` config packages to be
> published to npm first (they're referenced by name). Publish from this
> monorepo before ejecting consumers.

## Apps (deploy, don't publish)

Apps are the inverse of packages: **not published to npm, deployed to the open
internet by CI.** They live under `apps/*`, are `"private": true`, and run on
Vercel. Same toolchain as everything else — they extend `@aubron/tsconfig` /
`@aubron/eslint-config` by name and expose `build` / `dev` / `lint` /
`typecheck` / `test`, so `pnpm turbo run ...` and PR CI cover them for free.
Because they're private, the release flow ignores them and they need no
changeset.

```sh
pnpm new <name> --type app --description "..."   # scaffolds apps/<name> (Next.js)
pnpm --filter <name> dev                          # local dev server
```

### Deploy model (CI-first, same spirit as publishing)

Deploys live in the repo, not a dashboard: `.github/workflows/deploy.yml` builds
each app with the Vercel CLI and ships the prebuilt output using the org-scoped
`VERCEL_KEY` token. Each app is its own Vercel project, **keyed by its directory
name** — there are no project IDs to manage. The CLI _creates_ the project on the
first run (a real first deploy) and reuses it after, recording Root Directory =
`apps/<name>` so the pnpm-workspace install + Turbo cache work exactly as they do
locally. `apps/<name>/vercel.json` pins the framework.

### Wiring up a new app

1. Add `<name>` to the `matrix.app` list in `deploy.yml`. **That's the only
   required step** — the first push to `main` auto-creates the Vercel project.
2. _If the app needs runtime secrets_ (e.g. `OBA_API_KEY`), set them once on the
   Vercel project's env (dashboard or `vercel env add`).

The only shared inputs are the `VERCEL_KEY` **secret** (already org-scoped) and,
_optionally_, a `VERCEL_SCOPE` repo **variable** (a Vercel team slug) if the
token can see more than one team. No per-app variables, ever.

After that, every push to `main` that touches the app redeploys it automatically.

## Publishing

Auth is **npm Trusted Publishing (OIDC)** — no long-lived token is stored
(npm caps tokens at 90 days, so we don't depend on one). Provenance is on
(`publishConfig.provenance: true`) and the release workflow has `id-token: write`.

### ⚠️ First publish of a package is a one-time MANUAL, LOCAL release

Trusted Publishing is configured **per package, on a package that already exists**
on npm. A brand-new package can't be pre-trusted — so the very first publish of
each `@aubron/*` package can't come from the tokenless CI flow. You have to
bootstrap it by hand, once, from your machine. After that, CI does everything.

The chicken-and-egg, concretely:

```
new package → CI publish needs OIDC → OIDC needs a trusted publisher
→ trusted publisher needs the package to exist → package needs a publish ✋
```

**Bootstrap (run once, locally, from a clean `main` after the package is merged):**

```sh
# 1. Authenticate. A short-lived (≤90-day) granular token scoped to publish
#    @aubron/* is plenty for a one-off — revoke it when you're done. Or `npm login`.
npm whoami                      # confirm the right account / @aubron access

# 2. Apply pending changesets → real versions (0.0.0 → 0.1.0) + changelogs
pnpm changeset version
pnpm install                    # refresh the lockfile after the bumps

# 3. Build, then publish every public package. pnpm rewrites workspace:/catalog:
#    to real ranges. --no-provenance because provenance can ONLY be generated
#    from CI/OIDC; this first release simply won't have it (CI releases will).
pnpm -r build
pnpm -r publish --access public --no-provenance --no-git-checks

# 4. Commit the version bumps so the repo matches npm, then push.
#    There are no changesets left, so the release workflow is a no-op.
git commit -am "Release initial versions"
git push
```

> Order matters: publish (step 3) **before** pushing (step 4). Once the packages
> exist on npm, the CI `changeset publish` would be a no-op anyway, but publishing
> first avoids any race.

### After the bootstrap — configure OIDC, then never touch tokens again

1. On npmjs.com → each package → **Settings → Trusted Publisher** → add this
   GitHub repo (`GraffAI/aubron`) and the `Release` workflow
   (`.github/workflows/release.yml`).
2. Revoke the bootstrap token.
3. From now on the normal flow is fully tokenless and gets provenance: run
   `pnpm changeset`, merge the PR, merge the Version Packages PR → CI publishes.

> A token fallback still exists if you ever need it: add an `NPM_TOKEN` repo
> secret and uncomment the `NPM_TOKEN` line in `release.yml`.

> The same one-time bootstrap applies to **ejected** standalone repos, and the
> `@aubron/*` config packages must be published (via this bootstrap) before any
> ejected consumer can install — they're referenced by name.

## Conventions

- **ESM only** (`"type": "module"`), `Bundler` module resolution (tsup bundles).
- **Node 22+** (`engines`), with `.nvmrc` on the latest LTS (24) and a pinned
  `packageManager` (`pnpm@11`).
- **Shared versions live in the pnpm catalog** (`catalog:`); cross-package deps
  use `workspace:*`.
- **No conventional commits** — plain messages, no commitlint.
- Every package exposes `build` / `dev` / `test` / `lint` / `typecheck`.
