import { preset } from "@aubron/tsup-config";

// CLIs need a shebang so the built dist/index.js is directly executable.
export default preset({ banner: { js: "#!/usr/bin/env node" } });
