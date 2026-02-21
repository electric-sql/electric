---
title: AGENTS.md & SKILL.md
description: >-
  Documentation for guiding coding agents and loading agent skills to develop apps with Electric.
outline: [2, 3, 4]
---

<img src="/img/icons/llms.svg" class="product-icon"
    style="width: 72px"
/>

# Agent Instructions & Skills

Load our agent instruction and skill files to use Electric with AI coding agents.

## AGENTS.md

### Using Electric with coding agents

Electric provides an AGENTS.md at [https://electric-sql.com/AGENTS.md](/AGENTS.md){target="_self"}.

AGENTS.md is a [simple open format](https://agents.md) for guiding coding agents. It contains instructions for AI coding agents, formatted in a way they can easily digest.

Your coding agent or AI code editor may automatically read AGENTS.md. Or you can tell it to do so in your prompt, for example:

```sh
claude "Read AGENTS.md. Build an app with Electric and TanStack DB."
```

### File contents

Copy our [`AGENTS.md`](/AGENTS.md){target="_self"} file to the root of your repo or package. Edit it and / or combine with your other project-specific instructions, as you see fit.

<<< @/../AGENTS.md

---

## SKILL.md

### Using Electric with agent skills

Electric provides a SKILL.md at [https://electric-sql.com/SKILL.md](/SKILL.md){target="_self"}.

SKILL.md is an [open format](https://agentskills.io) for defining modular, reusable capabilities that AI coding agents can load on-demand. Unlike AGENTS.md which provides general project instructions, a skill encapsulates specific procedural knowledge, SDK patterns, and best practices for targeted tasks.

Your coding agent or AI code editor may automatically discover and load SKILL.md when needed. Or you can explicitly reference it in your prompt, for example:

```sh
claude "Load the Electric skill. Help me set up local-first sync with conflict resolution."
```

### What are agent skills?

Agent skills are specialized instruction packages that help AI coding agents perform specific tasks more effectively. Each skill contains:

- **Procedural knowledge** - Step-by-step workflows for common tasks
- **SDK patterns** - Best practices and code examples
- **Tool integrations** - Scripts and configuration guidance
- **Troubleshooting** - Common issues and solutions

Skills use "progressive disclosure" - the agent only loads the context it needs, when it needs it, rather than overwhelming the AI with unnecessary details upfront.

### File contents

Copy our [`SKILL.md`](/SKILL.md){target="_self"} file to the root of your repo or package. Edit it and / or combine with your other project-specific skills, as you see fit.

<<< @/../SKILL.md

---

## More information

See the [AGENTS.md website](https://agents.md) and [agentskills.io](https://agentskills.io) / [skills.sh](https://skills.sh) for more information about these formats. You may also be interested in our blog posts on:

- [Untangling the LLM Spaghetti](/blog/2025/04/22/untangling-llm-spaghetti)
- [Building AI apps on sync](/blog/2025/04/09/building-ai-apps-on-sync)
- [Bringing agents back down to earth](/blog/2025/08/12/bringing-agents-back-down-to-earth)
