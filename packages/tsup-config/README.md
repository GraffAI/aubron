# @aubron/tsup-config

Shared [tsup](https://tsup.egoist.dev) build preset for `@aubron` packages.

## Usage

```ts
// tsup.config.ts (library)
import { preset } from "@aubron/tsup-config";
export default preset();

// tsup.config.ts (CLI — add a shebang banner)
import { preset } from "@aubron/tsup-config";
export default preset({ banner: { js: "#!/usr/bin/env node" } });
```

`tsup` is a peer dependency — install it alongside this package.
