# __PKG__

A Claude Agent Skill, published from the `@aubron` package factory and
distributed through the `aubron` plugin marketplace.

## Install

From the marketplace (recommended):

```sh
# add the marketplace once
claude plugin marketplace add GraffAI/aubron
# then install this skill's plugin
claude plugin install __NAME__@aubron
```

The skill lives at [`skills/__NAME__/SKILL.md`](skills/__NAME__/SKILL.md). Edit
that file to change the skill; the frontmatter `description` controls when Claude
invokes it.

## Develop

```sh
pnpm --filter __PKG__ test   # validate the skill (aubron-skill validate)
pnpm --filter __PKG__ lint   # prettier --check
```
