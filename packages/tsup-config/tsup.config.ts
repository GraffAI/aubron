import { defineConfig } from "tsup";

// This package can't consume its own preset (chicken-and-egg), so it declares a
// plain tsup config that mirrors the preset's defaults.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  dts: true,
  sourcemap: true,
  clean: true,
});
