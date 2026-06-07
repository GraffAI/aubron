# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release, run:

```sh
pnpm changeset
```

On merge to `main`, CI opens a **Version Packages** PR. Merging that PR
publishes to npm.
