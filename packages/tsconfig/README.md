# @aubron/tsconfig

Shared TypeScript configurations for `@aubron` packages.

## Usage

Reference by package name in your `tsconfig.json` — this resolves via the
workspace symlink inside the monorepo and via `node_modules` in a standalone
repo, so no path rewriting is needed when a package is ejected.

```jsonc
// libraries
{ "extends": "@aubron/tsconfig/lib.json" }

// CLIs
{ "extends": "@aubron/tsconfig/cli.json" }
```

| Config      | Purpose                                              |
| ----------- | ---------------------------------------------------- |
| `base.json` | Strict, ESM, `Bundler` resolution. No ambient types. |
| `lib.json`  | `base` + `@types/node`.                              |
| `cli.json`  | `lib` (separate so CLI settings can diverge later).  |
