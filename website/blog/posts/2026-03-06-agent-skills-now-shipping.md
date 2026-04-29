---
title: "Agent skills now shipping in our npm packages"
description: >-
  Electric, TanStack DB, and Durable Streams now ship agent skills — versioned knowledge that travels with your packages so coding agents actually understand how to use them.
excerpt: >-
  We've been collaborating with TanStack to ship agent skills in our npm packages. Run one command to give your agent deep knowledge of Electric, TanStack DB and Durable Streams.
authors: [kyle]
image: /img/blog/agent-skills-now-shipping/hero.png
imageWidth: 2752
imageHeight: 1536
tags: [agents, agentic, AI, development]
outline: [2, 3]
post: true
---

We've been collaborating with the [TanStack](https://tanstack.com) maintainers on a new [Intent system](https://tanstack.com/blog/from-docs-to-agents) for shipping agent skills with npm packages. Our packages now ship with skills built in.

Update to the latest versions of `@tanstack/db`, `@electric-sql/client`, and `@durable-streams/client`, then ask your coding agent to run:

```bash
npx @tanstack/intent install
```

This loads a skill *inside your agent* that installs the relevant skills for your project's dependencies. When it finishes, your agent has structured, versioned knowledge of how to use these libraries correctly.

## Why This Matters

If you've used a coding agent with a fast-moving library, you've felt the pain. The agent confidently writes code against APIs renamed two versions ago. For newer libraries like [Durable Streams](/streams/), agents know nothing — the library falls outside their training data. You paste in docs; the agent half-reads them. You point it at a rules file on GitHub; it's already stale.

As we wrote on the TanStack blog, the core problem is version fragmentation: "once a breaking change ships, models don't 'catch up.' They develop a permanent split-brain — training data contains both versions forever with no way to disambiguate."

The workarounds — hunting for community-maintained rules files, copy-pasting knowledge with no versioning or staleness signal — fail to scale. Library maintainers already hold the knowledge agents need: docs, migration guides, type signatures. But none of it reached agents through a channel the maintainer controls.

## Skills That Travel With Your Packages

Shipping skills *inside* the package fixes this. When you `npm update`, the skills update too — a single source of truth, maintained by us, versioned and distributed through the same channel as the code.

This creates a compounding loop: when users report skill issues, the fix ships to everyone on the next release. Each `npm update` distributes the improvement across the entire user base.

## Try It

Clone the [Playbook repo](https://github.com/KyleAMathews/kpb) — it's set up with Electric, TanStack DB, and Durable Streams as dependencies, so the intent install pulls in all the relevant skills. Fire up your coding agent and ask it to build something.

We'd love to hear how the skills work for you. They're new and may have rough edges. We've made a feedback skill that walks you through telling the maintainers what can be improved — run it with:

```bash
npx @tanstack/intent meta collection-feedback
```

Every report makes the skills better for everyone.
