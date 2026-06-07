# aubron — agent guide

A **package factory**: a pnpm + Turborepo monorepo for publishing TypeScript
packages to npm under `@aubron/*`. Standards live in published config packages
(`@aubron/tsconfig`, `@aubron/eslint-config`, `@aubron/prettier-config`,
`@aubron/tsup-config`) and are referenced **by package name**, never by path —
that's what lets a package eject into its own repo with no config rewriting.

## The commands that matter

| Command                                      | What it does                                 |
| -------------------------------------------- | -------------------------------------------- |
| `pnpm new <name> --type <lib\|cli\|skill>`   | Scaffold a new publish-ready package.        |
| `pnpm eject <name> [--push]`                 | Copy a package out into a standalone repo.   |
| `pnpm changeset`                             | Record release intent (the only local step). |
| `pnpm turbo run build test lint typecheck`   | Run everything (cached, dependency-ordered). |
| `pnpm format` / `pnpm format:check`          | Prettier write / check.                      |
| `aubron-skill validate` / `sync-marketplace` | Validate a skill / refresh the marketplace.  |

## Where things live

- `packages/*` — the config packages and shippable packages.
- `scripts/gen.ts` — implements `new` and `eject`.
- `scripts/templates/` — `package/` (base), `types/{lib,cli}/` (overlays),
  `skill/` (skill package template), `standalone/` (ejected-repo extras).
- `.claude-plugin/marketplace.json` — generated catalog of skill packages (the
  `aubron` plugin marketplace). Never hand-edit; run `aubron-skill sync-marketplace`.
- `pnpm-workspace.yaml` — workspaces **and the version catalog**.

## Skills

This repo also ships **Claude Agent Skills** as packages (see the `skill-factory`
skill for the full runbook):

- `pnpm new <name> --type skill` scaffolds a skill package — a `SKILL.md` plus a
  `.claude-plugin/plugin.json`, published under `@aubron/*` and listed in the root
  marketplace. Skill packages expose `test` (`aubron-skill validate`) + `lint`
  (they're documentation, not TS, so they skip `build`/`typecheck`).
- The marketplace uses **hybrid sources**: `git-subdir` by default (no publish),
  `npm` for released skills (set `aubronSkill.source` in the package's package.json).
  Users: `claude plugin marketplace add GraffAI/aubron` → `claude plugin install <name>@aubron`.
- **Library-bundled skills** (e.g. `@aubron/ankerts-cli` ships an `ankerts`
  skill under `skills/` + `ankerts skills install`) are the alternative for
  shipping a skill _with_ a library. Never install skills via a `postinstall`.

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
