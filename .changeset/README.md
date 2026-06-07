# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release, run:

```sh
pnpm changeset
```

Pick the affected packages and a bump type (patch/minor/major), then write a
short summary. Commit the generated `.changeset/*.md` file with your PR.

On merge to `main`, CI opens a **Version Packages** PR that consumes these
files, bumps versions, and updates changelogs. Merging that PR publishes to npm.
