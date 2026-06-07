# aubron — agent guide

A **package factory**: a pnpm + Turborepo monorepo for publishing TypeScript
packages to npm under `@aubron/*`. Standards live in published config packages
(`@aubron/tsconfig`, `@aubron/eslint-config`, `@aubron/prettier-config`,
`@aubron/tsup-config`) and are referenced **by package name**, never by path —
that's what lets a package eject into its own repo with no config rewriting.

## The commands that matter

| Command                                    | What it does                                 |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm new <name> --type <lib\|cli>`        | Scaffold a new publish-ready package.        |
| `pnpm eject <name> [--push]`               | Copy a package out into a standalone repo.   |
| `pnpm changeset`                           | Record release intent (the only local step). |
| `pnpm turbo run build test lint typecheck` | Run everything (cached, dependency-ordered). |
| `pnpm format` / `pnpm format:check`        | Prettier write / check.                      |

## Where things live

- `packages/*` — the config packages and shippable packages.
- `scripts/gen.ts` — implements `new` and `eject`.
- `scripts/templates/` — `package/` (base), `types/{lib,cli}/` (overlays),
  `standalone/` (extra files an ejected repo gets).
- `pnpm-workspace.yaml` — workspaces **and the version catalog**.

## Conventions

- **ESM only** (`"type": "module"`). No CJS output. `Bundler` resolution; tsup
  bundles to `dist/`.
- **Config by reference.** Don't fork or inline `@aubron/*` config — bump the
  dependency. New packages extend the shared tsconfig/eslint/prettier/tsup.
- **Versions in the catalog.** Shared tool versions are `catalog:` entries in
  `pnpm-workspace.yaml`; cross-package deps are `workspace:*`. Don't pin tool
  versions per package.
- **No conventional commits.** Plain messages; no commitlint.
- **Every package** exposes `build` / `dev` / `test` / `lint` / `typecheck`.
- **Releases are CI-first.** Locally you only `pnpm changeset`. Merging to
  `main` opens a Version Packages PR; merging that publishes (provenance on).
- **First publish of any new package is a one-time MANUAL, LOCAL release.** npm
  Trusted Publishing (OIDC) can only be configured on a package that already
  exists, so the tokenless CI flow can't do the _first_ publish. Bootstrap it by
  hand once — see the "First publish" section in [README](README.md) — then CI
  takes over. Don't expect the first CI release of a brand-new package to work.
- A `packages/**` change **requires a changeset** (enforced in CI).

Ejected repos get their own `CLAUDE.md` from `scripts/templates/standalone/`.
