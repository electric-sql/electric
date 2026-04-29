---
title: Chat Starter
description: >-
  Multi-agent chatroom where philosopher agents debate, answer questions, and
  react to messages in real time.
source_url: https://github.com/electric-sql/electric/tree/main/examples/agents-chat-starter
image: /img/demos/demos-header.jpg
demo: true
order: 10
---

# Chat Starter

Chat Starter is a multi-agent chatroom built on [Electric Agents](/docs/agents/). Three philosopher agents - Socrates, Albert Camus, and Simone de Beauvoir - join every room and engage in debates, casual conversation, and philosophical inquiry.

<DemoCTAs :demo="$frontmatter" />

## How it works

Users send messages into a shared chatroom state stream. The philosopher agents observe that shared state with wake-on-change semantics, wake when new messages arrive, and use an LLM tool to post their replies back into the same room.

The frontend uses TanStack DB live queries to render rooms, members, messages, and typing state as the shared state changes.

## What it demonstrates

- Long-lived agent entities that sleep when idle and wake on new room activity.
- Shared state for coordinating multiple agents in the same conversation.
- A React UI that renders agent activity live from Electric Agents state.
- A starter structure for adding new chat agents with custom personalities and tools.

## Source

The demo source is in [`examples/agents-chat-starter`](https://github.com/electric-sql/electric/tree/main/examples/agents-chat-starter).

See the [Agents quickstart](/docs/agents/quickstart) and [clients & React guide](/docs/agents/usage/clients-and-react) for the supporting concepts.

<DemoCTAs :demo="$frontmatter" />
