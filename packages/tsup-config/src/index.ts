import { defineConfig, type Options } from "tsup";

/**
 * Shared tsup preset. Consumers spread their own overrides on top, e.g. a CLI
 * passes `{ banner: { js: "#!/usr/bin/env node" } }`.
 */
export function preset(options: Options = {}) {
  return defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node22",
    dts: true,
    sourcemap: true,
    clean: true,
    ...options,
  });
}
