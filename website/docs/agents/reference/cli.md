---
title: CLI
titleTemplate: "... - Electric Agents"
description: >-
  Command reference for the darix CLI: spawn, send, observe, inspect, list, and manage entities.
outline: [2, 3]
---

# CLI reference

The Electric Agents CLI (`darix`) manages entity types and entities. Install from `@durable-streams/darix-cli`.

```bash
npm install -g @durable-streams/darix-cli
```

## Environment variables

| Variable         | Default                 | Purpose                      |
| ---------------- | ----------------------- | ---------------------------- |
| `DARIX_URL`      | `http://localhost:4437` | Server URL                   |
| `DARIX_IDENTITY` | `user@hostname`         | Sender identity for messages |

## Commands

### `darix types`

List registered entity types.

```bash
darix types
```

### `darix types inspect <name>`

Show entity type details. Outputs JSON.

```bash
darix types inspect chat
```

### `darix types delete <name>`

Delete an entity type registration.

```bash
darix types delete chat
```

### `darix spawn <url-path> [--args <json>]`

Spawn an entity. URL path format: `/<type>/<id>`.

```bash
darix spawn /chat/my-convo
darix spawn /chat/my-convo --args '{"topic": "AI safety"}'
```

| Option          | Description                    |
| --------------- | ------------------------------ |
| `--args <json>` | Spawn arguments as JSON object |

### `darix send <url> <message...> [--type <msg-type>] [--json]`

Send a message to an entity. By default, wraps the message string as `{ text: "..." }`. Use `--json` to send raw JSON.

```bash
darix send /chat/my-convo 'Hello!'
darix send /chat/my-convo '{"custom": "payload"}' --json
darix send /chat/my-convo 'alert' --type warning
```

| Option              | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `--type <msg-type>` | Set the message type field                                       |
| `--json`            | Parse message argument as JSON instead of wrapping as `{ text }` |

### `darix observe <url> [--from <offset>]`

Stream entity events in real-time. Requires an interactive terminal.

```bash
darix observe /chat/my-convo
darix observe /chat/my-convo --from 0
```

| Option            | Description                      |
| ----------------- | -------------------------------- |
| `--from <offset>` | Start streaming from this offset |

### `darix inspect <url>`

Show entity details. Outputs JSON.

```bash
darix inspect /chat/my-convo
```

### `darix ps [--type <type>] [--status <status>] [--parent <url>]`

List entities with optional filters.

```bash
darix ps
darix ps --type chat --status running
darix ps --parent /manager/my-manager
```

| Option              | Description                 |
| ------------------- | --------------------------- |
| `--type <type>`     | Filter by entity type       |
| `--status <status>` | Filter by status            |
| `--parent <url>`    | Filter by parent entity URL |

Output shows `URL`, `STATUS`, `CREATED`, and `LAST ACTIVE` columns with human-readable relative timestamps. Results are sorted by most recently active first.

### `darix kill <url>`

Delete an entity.

```bash
darix kill /chat/my-convo
```

### `darix completion [action]`

Set up shell completions. Without arguments, prints setup instructions.

```bash
darix completion            # Show setup instructions
darix completion install    # Auto-install into your shell init file
```

**Manual setup** (add to your shell init file):

```bash
# Bash (~/.bashrc) or Zsh (~/.zshrc)
eval "$(darix --completion)"

# Fish (~/.config/fish/config.fish)
darix --completion-fish | source
```

Completions provide tab-completion for commands, flags, entity types, and entity URLs.
