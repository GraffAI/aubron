# transit

Puget Sound transit, live — a bespoke WebGL map of every Link train, Sounder, streetcar and bus in motion.

An **app** in the aubron monorepo: not published to npm, deployed to the open
internet by CI (Vercel). See the repo README's "Apps" section for the deploy
model.

## Develop

```bash
pnpm --filter transit dev        # next dev
pnpm --filter transit build      # next build
pnpm --filter transit lint
pnpm --filter transit typecheck
pnpm --filter transit test
```
