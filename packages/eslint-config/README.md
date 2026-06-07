# @aubron/eslint-config

Shared ESLint flat configuration for `@aubron` packages. ESLint recommended +
`typescript-eslint` (correctness only) + `eslint-config-prettier` to disable any
formatting overlap with Prettier.

## Usage

```js
// eslint.config.js
export { default } from "@aubron/eslint-config";
```

`eslint` is a peer dependency — install it alongside this package.
