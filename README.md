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
  greet/           @aubron/greet           — example CLI (proves the system)
scripts/gen.ts     — `new` + `eject` commands; templates/ alongside
```

## Create a package

```sh
pnpm new <name> --type <lib|cli> [--description "..."]
pnpm new color --type lib
pnpm new todo --type cli --description "A todo CLI"
```

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
pnpm eject greet --push
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

## npm Trusted Publishing (OIDC)

Provenance is on (`publishConfig.provenance: true`) and the release workflow has
`id-token: write`. Preferred auth is **npm Trusted Publishing**, so no
long-lived token is stored:

1. Publish each package once (so it exists on npm).
2. On npmjs.com → the package → **Settings → Trusted Publisher**, add this
   GitHub repo and the `Release` workflow (`.github/workflows/release.yml`).
3. Leave `NPM_TOKEN` unset. The OIDC exchange in CI authenticates the publish.

To fall back to a token instead, add an `NPM_TOKEN` repo secret and uncomment the
`NPM_TOKEN` line in `release.yml`.

## Conventions

- **ESM only** (`"type": "module"`), `Bundler` module resolution (tsup bundles).
- **Node 22+** (`engines`), with `.nvmrc` on the latest LTS (24) and a pinned
  `packageManager` (`pnpm@11`).
- **Shared versions live in the pnpm catalog** (`catalog:`); cross-package deps
  use `workspace:*`.
- **No conventional commits** — plain messages, no commitlint.
- Every package exposes `build` / `dev` / `test` / `lint` / `typecheck`.
