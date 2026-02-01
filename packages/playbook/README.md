# @electric-sql/playbook

Electric Playbook - skills for building apps with [Electric](https://electric-sql.com).

## Overview

This package provides AI agent skills that help coding assistants (Claude, Cursor, Copilot, etc.) build local-first applications with Electric and TanStack DB.

## Installation

```bash
npm install @electric-sql/playbook
```

## Usage

### CLI Commands

Install thin skill pointers to your agent's skills directory:

```bash
npx @electric-sql/playbook install
```

Install globally (to `~/.claude/skills`, etc.):

```bash
npx @electric-sql/playbook install --global
```

List available skills:

```bash
npx @electric-sql/playbook list
```

Output the full content of a skill:

```bash
npx @electric-sql/playbook show electric
```

### Finding Skills by Keyword

When you don't know the exact skill name, grep the installed package:

```bash
# Search for skills mentioning a keyword
grep -r "SSR" node_modules/@electric-sql/playbook/skills/

# Find all skill files
find node_modules -name "SKILL.md" -path "*playbook*"
```

### Skills

This package includes the following skills:

| Skill                           | Description                                               |
| ------------------------------- | --------------------------------------------------------- |
| `electric`                      | Router skill - Electric ecosystem overview and navigation |
| `electric-quickstart`           | Getting started with Electric + TanStack DB               |
| `tanstack-start-quickstart`     | Complete TanStack Start + Electric setup (SSR config)     |
| `electric-tanstack-integration` | Deep integration patterns for Electric with TanStack DB   |
| `electric-security-check`       | Security audit checklist for Electric apps                |
| `electric-go-live`              | Production readiness checklist                            |
| `deploying-electric`            | Deployment patterns (Cloud, Docker, self-hosted)          |

Additional skills are available in other Electric packages:

- `@electric-sql/client` - `electric-shapes`, `electric-auth`, `electric-http-api`

## How It Works

Skills are markdown files with YAML frontmatter that provide context and instructions to AI coding assistants. When installed, thin pointers are created in your agent's skills directory that reference the full skill content in the npm package.

## License

Apache-2.0
