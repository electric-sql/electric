---
title: AGENTS.md
description: >-
  Documentation for guiding coding agents to develop apps with Electric.
outline: [2, 3]
---

<img src="/img/icons/llms.svg" class="product-icon"
    style="width: 72px"
/>

# AGENTS.md

Load our [`AGENTS.md`](/AGENTS.md){target="\_self"} file to use Electric with AI coding agents.

## Using Electric with coding agents

Electric provides an AGENTS.md at [https://electric-sql.com/AGENTS.md](/AGENTS.md){target="\_self"}.

AGENTS.md is a [simple open format](https://agents.md) for guiding coding agents. It contains instructions for AI coding agents, formatted in a way they can easily digest.

Your coding agent or AI code editor may automatically read AGENTS.md. Or you can tell it to do so in your prompt, for example:

```sh
claude "Read AGENTS.md. Build an app with Electric and TanStack DB."
```

## File contents

Copy our [`AGENTS.md`](/AGENTS.md){target="\_self"} file to the root of your repo or package. Edit it and / or combine with your other project-specific instructions, as you see fit.

<<< @/../AGENTS.md

## More information

See the [AGENTS.md website](https://agents.md) for more information. You may also be interested in our blog posts on:

- [Untangling the LLM Spaghetti](/blog/2025/04/22/untangling-llm-spaghetti)
- [Building AI apps on sync](/blog/2025/04/09/building-ai-apps-on-sync)
- [Bringing agents back down to earth](/blog/2025/08/12/bringing-agents-back-down-to-earth)
