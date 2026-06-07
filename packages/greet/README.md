# @aubron/greet

A tiny example CLI that greets you. It exists to prove the `@aubron` package
factory works end to end — and as the reference output for
`pnpm new <name> --type cli`.

## Usage

```sh
npx @aubron/greet            # Hello, world!
npx @aubron/greet Ada        # Hello, Ada!
npx @aubron/greet Ada --shout  # HELLO, ADA!
```

## API

```ts
import { greet } from "@aubron/greet";

greet("Ada"); // "Hello, Ada!"
greet("Ada", true); // "HELLO, ADA!"
```
