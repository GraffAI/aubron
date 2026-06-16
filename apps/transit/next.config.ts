import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// In a pnpm monorepo, Next can infer the wrong workspace root and emit absolute
// /node_modules/... paths in the traced server output, which then 404 on Vercel.
// Pin tracing to the repo root (two levels up from apps/<name>) so the prebuilt
// function bundles the right files.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
