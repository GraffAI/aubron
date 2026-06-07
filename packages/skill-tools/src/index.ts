/**
 * @aubron/skill-tools — validate and release Claude Agent Skills from the
 * @aubron package factory.
 *
 * This module is the library surface (validation + marketplace functions). The
 * `aubron-skill` CLI lives in `cli.ts` so it can run unconditionally as a bin
 * without a fragile main-module guard.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export * from "./frontmatter.js";
export * from "./validate.js";
export * from "./marketplace.js";

/** Walk up from `start` until the pnpm workspace root is found. */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("could not find repo root (no pnpm-workspace.yaml)");
    dir = parent;
  }
}
