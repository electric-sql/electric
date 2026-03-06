---
title: "Agent Skills Now Shipping in Our npm Packages"
description: >-
  Electric, TanStack DB, and Durable Streams now ship agent skills — versioned knowledge that travels with your packages so coding agents actually understand how to use them.
excerpt: >-
  We've been collaborating with the TanStack maintainers to ship agent skills directly in our npm packages. Update your dependencies and run one command to give your coding agent deep knowledge of Electric, TanStack DB, and Durable Streams.
authors: [kyle]
image: /img/blog/agent-skills-now-shipping/hero.png
tags: [agentic, AI, development]
outline: [2, 3]
post: true
---

We've been collaborating with the [TanStack](https://tanstack.com) maintainers: our npm packages now ship with agent skills built in.

Update to the latest versions of `@tanstack/db`, `@electric-sql/client`, and `@durable-streams/client`, then ask your coding agent to run:

```bash
npx @tanstack/intent install
```

This loads a skill *inside your agent* that installs the relevant skills for your project's dependencies. When it finishes, your agent has structured, versioned knowledge of how to use these libraries correctly.

## Why This Matters

If you've used a coding agent with a fast-moving library, you've felt the pain. The agent confidently writes code against APIs renamed two versions ago. For newer libraries like Durable Streams, agents know nothing — the library falls outside their training data. You paste in docs; the agent half-reads them. You point it at a rules file on GitHub; it's already stale.

As we [wrote on the TanStack blog](https://tanstack.com/blog/from-docs-to-agents), the core problem is version fragmentation: "once a breaking change ships, models don't 'catch up.' They develop a permanent split-brain — training data contains both versions forever with no way to disambiguate."

The workarounds — hunting for community-maintained rules files, copy-pasting knowledge with no versioning or staleness signal — fail to scale. Library maintainers already hold the knowledge agents need: docs, migration guides, type signatures. But none of it reached agents through a channel the maintainer controls.

## Skills That Travel With Your Packages

Agent skills fix this by shipping knowledge *inside* the package. When you `npm update`, the skills update too — a single source of truth, maintained by us, versioned and distributed through the same channel as the code.

This creates a compounding loop: when users report skill issues, the fix ships to everyone on the next release. Each `npm update` distributes the improvement across the entire user base.

## Try It

Clone [github.com/KyleAMathews/kpb](https://github.com/KyleAMathews/kpb), fire up your coding agent, and ask it to build something. The skills give the agent real understanding of how Electric sync, TanStack DB, and Durable Streams fit together — so you can focus on building instead of correcting stale assumptions.

We'd love to hear how the skills work for you. They're new and have rough edges. Run:

```bash
npx @tanstack/intent meta collection-feedback
```

This loads a skill that walks you through giving feedback to the maintainers. Every report makes the skills better for everyone.
