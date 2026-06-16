# __NAME__

__DESCRIPTION__

An **app** in the aubron monorepo: not published to npm, deployed to the open
internet by CI (Vercel). See the repo README's "Apps" section for the deploy
model.

## Develop

```bash
pnpm --filter __NAME__ dev        # next dev
pnpm --filter __NAME__ build      # next build
pnpm --filter __NAME__ lint
pnpm --filter __NAME__ typecheck
pnpm --filter __NAME__ test
```
