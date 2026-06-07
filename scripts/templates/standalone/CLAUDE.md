# __PKG__ — agent guide

This is a standalone TypeScript package that was **ejected** from the `aubron`
package factory. It inherits the same standards via published config packages
(`@aubron/tsconfig`, `@aubron/eslint-config`, `@aubron/prettier-config`,
`@aubron/tsup-config`) — referenced by name, never by path.

## Commands

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `pnpm build`     | Bundle to `dist/` with tsup (ESM). |
| `pnpm test`      | Run Vitest.                        |
| `pnpm lint`      | ESLint (correctness only).         |
| `pnpm typecheck` | `tsc --noEmit`.                    |
| `pnpm format`    | Prettier write.                    |
| `pnpm changeset` | Record a release intent.           |

## Conventions

- **ESM only** (`"type": "module"`). No CJS output.
- **Config by reference** — the `@aubron/*` config packages resolve from npm.
  Don't inline or fork their settings; bump the dependency instead.
- **No conventional commits.** Plain commit messages.
- **Releases are CI-first**: run `pnpm changeset`, open a PR, merge. CI opens a
  Version Packages PR; merging it publishes to npm (provenance on).
