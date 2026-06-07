import { preset } from "@aubron/tsup-config";

// Two entries: the library (index) and the `aubron-skill` CLI (cli, with a
// shebang). Node strips the shebang from index.js when it's imported as a lib.
export default preset({
  entry: ["src/index.ts", "src/cli.ts"],
  banner: { js: "#!/usr/bin/env node" },
});
