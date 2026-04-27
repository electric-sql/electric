---
title: CLI
titleTemplate: "... - Electric Agents"
description: >-
  Command reference for the Electric Agents CLI: spawn, send, observe, inspect, list, and manage entities.
outline: [2, 3]
---

# CLI reference

The Electric Agents CLI manages entity types and entities. Install it from `electric-ax`, then use the `electric agents` command. You can also run one-off commands with `npx electric-ax agents ...`.

```bash
npm install -g electric-ax
```

## Environment variables

| Variable                         | Default                 | Purpose                                      |
| -------------------------------- | ----------------------- | -------------------------------------------- |
| `ELECTRIC_AGENTS_URL`            | `http://localhost:4437` | Server URL for entity commands and built-ins |
| `ELECTRIC_AGENTS_IDENTITY`       | `user@hostname`         | Sender identity for messages                 |
| `ELECTRIC_AGENTS_PORT`           | `4437`                  | Port used by `start` / `quickstart`          |
| `ELECTRIC_AGENTS_BUILTIN_PORT`   | `4448`                  | Webhook port for `start-builtin`             |
| `ELECTRIC_AGENTS_COMPOSE_PROJECT` | `electric-agents`       | Docker Compose project name                  |
| `ANTHROPIC_API_KEY`              | -                       | Required for `start-builtin` and `quickstart` |

## Commands

### <span class="cli-command"><code>types</code></span> {#types}

List registered entity types.

```bash
electric agents types
```

### <span class="cli-command"><code>types inspect &lt;name&gt;</code></span> {#types-inspect-name}

Show entity type details. Outputs JSON.

```bash
electric agents types inspect chat
```

### <span class="cli-command"><code>types delete &lt;name&gt;</code></span> {#types-delete-name}

Delete an entity type registration.

```bash
electric agents types delete chat
```

### <span class="cli-command"><code>spawn &lt;url-path&gt; [--args &lt;json&gt;]</code></span> {#spawn-url-path-args-json}

Spawn an entity. URL path format: `/<type>/<id>`.

```bash
electric agents spawn /chat/my-convo
electric agents spawn /chat/my-convo --args '{"topic": "AI safety"}'
```

| Option          | Description                    |
| --------------- | ------------------------------ |
| `--args <json>` | Spawn arguments as JSON object |

### <span class="cli-command"><code>send &lt;url&gt; &lt;message...&gt; [--type &lt;msg-type&gt;] [--json]</code></span> {#send-url-message-type-json}

Send a message to an entity. By default, wraps the message string as `{ text: "..." }`. Use `--json` to send raw JSON.

```bash
electric agents send /chat/my-convo 'Hello!'
electric agents send /chat/my-convo '{"custom": "payload"}' --json
electric agents send /chat/my-convo 'alert' --type warning
```

| Option              | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `--type <msg-type>` | Set the message type field                                       |
| `--json`            | Parse message argument as JSON instead of wrapping as `{ text }` |

### <span class="cli-command"><code>observe &lt;url&gt; [--from &lt;offset&gt;]</code></span> {#observe-url-from-offset}

Stream entity events in real-time. Requires an interactive terminal.

```bash
electric agents observe /chat/my-convo
electric agents observe /chat/my-convo --from 0
```

| Option            | Description                      |
| ----------------- | -------------------------------- |
| `--from <offset>` | Start streaming from this offset |

### <span class="cli-command"><code>inspect &lt;url&gt;</code></span> {#inspect-url}

Show entity details. Outputs JSON.

```bash
electric agents inspect /chat/my-convo
```

### <span class="cli-command"><code>ps [--type &lt;type&gt;] [--status &lt;status&gt;] [--parent &lt;url&gt;]</code></span> {#ps-type-status-parent}

List entities with optional filters.

```bash
electric agents ps
electric agents ps --type chat --status running
electric agents ps --parent /manager/my-manager
```

| Option              | Description                 |
| ------------------- | --------------------------- |
| `--type <type>`     | Filter by entity type       |
| `--status <status>` | Filter by status            |
| `--parent <url>`    | Filter by parent entity URL |

Output shows `URL`, `STATUS`, `CREATED`, and `LAST ACTIVE` columns with human-readable relative timestamps. Results are sorted by most recently active first.

### <span class="cli-command"><code>kill &lt;url&gt;</code></span> {#kill-url}

Delete an entity.

```bash
electric agents kill /chat/my-convo
```

### <span class="cli-command"><code>start</code></span> {#start}

Start the local Electric Agents coordinator server, Postgres, Electric, and UI using Docker Compose.

```bash
electric agents start
```

### <span class="cli-command"><code>start-builtin [--anthropic-api-key &lt;key&gt;]</code></span> {#start-builtin}

Start the built-in Horton runtime and register built-in agent types with the coordinator server.

```bash
electric agents start-builtin --anthropic-api-key sk-ant-...
```

| Option                         | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `--anthropic-api-key <key>`    | Anthropic API key for the built-in Horton server |

### <span class="cli-command"><code>quickstart [--anthropic-api-key &lt;key&gt;]</code></span> {#quickstart}

Start the coordinator server, print onboarding commands, and run the built-in agents runtime.

```bash
electric agents quickstart --anthropic-api-key sk-ant-...
```

| Option                         | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `--anthropic-api-key <key>`    | Anthropic API key for the built-in Horton server |

### <span class="cli-command"><code>stop [--remove-volumes]</code></span> {#stop}

Stop the local Electric Agents dev environment.

```bash
electric agents stop
electric agents stop --remove-volumes
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `--remove-volumes` | Remove Docker volumes as well. |

### <span class="cli-command"><code>completion [action]</code></span> {#completion-action}

Set up shell completions. Without arguments, prints setup instructions.

```bash
electric agents completion            # Show setup instructions
electric agents completion install    # Auto-install into your shell init file
```

**Manual setup** (add to your shell init file):

```bash
# Bash (~/.bashrc) or Zsh (~/.zshrc)
eval "$(electric --completion)"

# Fish (~/.config/fish/config.fish)
electric --completion-fish | source
```

Completions provide tab-completion for commands, flags, entity types, and entity URLs.

<style scoped>
.cli-command code::before {
  content: "electric agents ";
}
</style>
