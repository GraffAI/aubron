# @aubron/skill-factory

A Claude Agent Skill, published from the `@aubron` package factory and
distributed through the `aubron` plugin marketplace.

## Install

From the marketplace (recommended):

```sh
# add the marketplace once
claude plugin marketplace add GraffAI/aubron
# then install this skill's plugin
claude plugin install skill-factory@aubron
```

The skill lives at [`skills/skill-factory/SKILL.md`](skills/skill-factory/SKILL.md). Edit
that file to change the skill; the frontmatter `description` controls when Claude
invokes it.

## Develop

```sh
pnpm --filter @aubron/skill-factory test   # validate the skill (aubron-skill validate)
pnpm --filter @aubron/skill-factory lint   # prettier --check
```
