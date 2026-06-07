import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Shared flat ESLint config: correctness rules only. Prettier is listed LAST so
 * `eslint-config-prettier` disables any stylistic rules that overlap with it.
 */
export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, prettier, {
  ignores: ["dist/**", "node_modules/**", ".turbo/**", "coverage/**"],
});
