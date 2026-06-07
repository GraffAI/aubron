#!/usr/bin/env node
// Committed launcher. pnpm creates a package's bin shims at INSTALL time and
// skips any whose target file is missing. The real CLI is built to dist/cli.js,
// which doesn't exist on a clean install — so pointing `bin` straight at it left
// `aubron-skill` unresolved on CI. This committed file always exists, so the
// shim is always created; it simply delegates to the built CLI (Turbo's
// `^build` guarantees dist/ is built before any consumer's script runs).
import "../dist/cli.js";
