---
name: skill-factory
description: Create, validate, and release a Claude Agent Skill from the @aubron package factory monorepo. Use this when adding a new skill to this repo, packaging a skill as an installable plugin, wiring it into the marketplace, or deciding how to distribute a skill (marketplace plugin vs library-bundled). Triggers on requests like "add a skill", "make this a skill", "publish/release a skill", or "how do we distribute skills here".
---

# skill-factory

How this monorepo contains and ships Claude Agent Skills. Skills here are **npm
packages that are also Claude plugins**: a `SKILL.md` plus a `.claude-plugin/plugin.json`,
published under `@aubron/*` and listed in a root marketplace. There are two
distribution shapes — pick by intent:

- **Standalone skill** → a `--type skill` package in the `aubron` marketplace.
- **Library-bundled skill** → a `SKILL.md` shipped _inside_ a normal library
  (e.g. `@aubron/ankerts-cli`) so consumers of that library can install it. See
  [Pattern B](#pattern-b-library-bundled-skills) below.

## Create a standalone skill

```sh
pnpm new <name> --type skill --description "One line: what it does + when to use it."
```

This scaffolds `packages/<name>/` with:

```
packages/<name>/
  .claude-plugin/plugin.json      # the plugin manifest (name = install id)
  skills/<name>/SKILL.md          # the skill itself
  package.json                    # @aubron/<name>; files ship .claude-plugin + skills
  README.md
```

It also drops a changeset and regenerates the root `.claude-plugin/marketplace.json`.

## Write a good SKILL.md

The frontmatter is the contract:

```yaml
---
name: my-skill # kebab-case; this is the /command name and install id
description: What it does AND when Claude should invoke it. # this line drives triggering
---
```

- **`name`** must be kebab-case (`a-z`, `0-9`, `-`).
- **`description`** is required and is _how Claude decides to trigger the skill_ —
  lead with the capability, then concrete triggers ("Use this when…"). Keep
  `description` (+ optional `when_to_use`) well under ~1024 chars.
- **Progressive disclosure**: keep `SKILL.md` small. Move deep reference docs,
  examples, and scripts into sibling files under `skills/<name>/` and link to
  them; the agent reads them only when needed.
- Optional frontmatter you may use: `allowed-tools`, `disable-model-invocation`
  (user-only), `user-invocable: false` (Claude-only), `argument-hint`, `model`.

## Validate

```sh
pnpm --filter @aubron/<name> test    # runs `aubron-skill validate`
pnpm --filter @aubron/<name> lint    # prettier --check
```

`aubron-skill validate` checks the plugin manifest, the SKILL.md frontmatter
(name kebab-case, description present and within limits), and the `skills/`
layout. `claude plugin validate .` is the Claude-native cross-check.

## Keep the marketplace in sync

The root `.claude-plugin/marketplace.json` is generated from the skill packages —
never hand-edit it. Regenerate after adding/removing a skill or changing its
source preference:

```sh
pnpm --filter @aubron/skill-tools exec aubron-skill sync-marketplace
# CI guard: fail if the committed file is stale
aubron-skill sync-marketplace --check
```

## Choose a source type (hybrid)

Each skill package declares how the marketplace should fetch it, via
`"aubronSkill": { "source": ... }` in its `package.json`:

- **`git-subdir`** (default): the marketplace points at `packages/<name>/` in the
  repo. No publish step — works the moment you push. Best for unreleased/dev skills.
- **`npm`**: the marketplace references the published `@aubron/<name>` package,
  pinned to `^version`. Best for released skills. Requires a changeset + publish.

Flip `git-subdir` → `npm` when a skill is ready to release, then re-run
`sync-marketplace`.

## Release

Releases are CI-first (same as every package here):

1. `pnpm changeset` (the scaffolder already wrote an initial one) — pick the bump.
2. Merge to `main` → the Version Packages PR bumps versions/changelogs.
3. Merge that → CI publishes `@aubron/<name>` to npm (provenance on).
4. If the skill uses an `npm` marketplace source, bump its pinned version and
   re-run `sync-marketplace`.

## Install / use a skill

```sh
claude plugin marketplace add GraffAI/aubron      # once
claude plugin install <name>@aubron               # install a skill's plugin
claude plugin list --available
```

## Pattern B: library-bundled skills

To ship a skill _with_ a library so its consumers get it (the way
`@aubron/ankerts-cli` ships an `ankerts` skill):

1. Put `skills/<skill>/SKILL.md` inside the library package and add `"skills"` to
   its `files` so it's published.
2. Point the SKILL.md at the package's own docs in `node_modules` (e.g. a
   `--json` introspection command or the README) — no network needed.
3. Expose an explicit installer (`<bin> skills install`) that copies the bundled
   skill into `.claude/skills/` on demand. **Never use a `postinstall` copy** —
   it's unversioned, hard to uninstall, and surprising.

Because `SKILL.md` is the open Agent Skills standard, the same file also works in
Codex, Cursor, and Copilot.

## Eject

`pnpm eject <name>` copies a skill package into its own repo, rewriting
`workspace:*`/`catalog:` deps to concrete versions. The ejected repo keeps its
`.claude-plugin/plugin.json` + `skills/`, so it can be referenced directly by a
`github`/`git-subdir` marketplace source.
