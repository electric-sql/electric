---
title: CLI
description: >-
  Command-line tool for creating, writing to, reading from, and managing Durable Streams. Supports piped input, JSON mode, batch writes, and token authentication.
outline: [2, 3]
---

# CLI

The Durable Streams CLI is a command-line tool for creating, writing to, reading from, and managing streams. It connects to any Durable Streams server over HTTP.

<IntentLink intent="create" serviceType="streams" />

## Installation

Install globally from npm:

```bash
npm install -g @durable-streams/cli
```

Or run directly with npx:

```bash
npx @durable-streams/cli <command> [options]
```

Once installed globally, the CLI is available as `durable-stream`.

## Environment variables

| Variable      | Description                                          | Default                           |
| ------------- | ---------------------------------------------------- | --------------------------------- |
| `STREAM_URL`  | Base URL of the stream server                        | `http://localhost:4437/v1/stream` |
| `STREAM_AUTH` | Authorization header value (e.g., `Bearer my-token`) | _(none)_                          |

Both can be overridden per-command with the `--url` and `--auth` flags.

## Global options

| Flag             | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `--url <url>`    | Stream server URL (overrides `STREAM_URL`)           |
| `--auth <value>` | Authorization header value (overrides `STREAM_AUTH`) |
| `--help`, `-h`   | Show usage information                               |

## Commands

### `create` -- Create a stream

```bash
durable-stream create <stream_id> [options]
```

**Options:**

| Flag                    | Description                                     | Default                    |
| ----------------------- | ----------------------------------------------- | -------------------------- |
| `--content-type <type>` | Content type for the stream                     | `application/octet-stream` |
| `--json`                | Shorthand for `--content-type application/json` |                            |

**Examples:**

```bash
# Create a plain stream
durable-stream create my-stream

# Create a JSON stream
durable-stream create events --json

# Create a stream with a specific content type
durable-stream create logs --content-type text/plain
```

### `write` -- Write data to a stream

```bash
durable-stream write <stream_id> [content] [options]
```

Content can be provided as an argument or piped from stdin. If no argument is given and stdin is not a TTY, the CLI reads from stdin. Escape sequences (`\n`, `\t`, `\r`, `\\`) in content arguments are converted to their literal equivalents.

**Options:**

| Flag                    | Description                                                                   | Default                    |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `--content-type <type>` | Content type for the message                                                  | `application/octet-stream` |
| `--json`                | Shorthand for `--content-type application/json`                               |                            |
| `--batch-json`          | Treat input as a JSON array; store each element separately (implies `--json`) |                            |

**Examples:**

```bash
# Write a string
durable-stream write my-stream "Hello, world!"

# Pipe from stdin
echo "Hello from stdin" | durable-stream write my-stream
cat file.txt | durable-stream write my-stream

# Write JSON
durable-stream write events '{"event": "user.created"}' --json

# Write a JSON array as individual messages
durable-stream write events '[{"a": 1}, {"a": 2}]' --batch-json
```

#### JSON array flattening with `--batch-json`

When using `--batch-json`, top-level arrays are flattened into individual messages:

| Input        | Messages stored        |
| ------------ | ---------------------- |
| `{}`         | 1 message: `{}`        |
| `[{}, {}]`   | 2 messages: `{}`, `{}` |
| `[[{}, {}]]` | 1 message: `[{}, {}]`  |

This matches the protocol's batch semantics. Without `--batch-json`, JSON values are always stored as a single message, even if they are arrays.

### `read` -- Read and follow a stream

```bash
durable-stream read <stream_id>
```

Reads all existing data from the stream and then follows it for live updates, streaming raw bytes to stdout. The command runs until interrupted with Ctrl+C.

For JSON streams, the output is concatenated JSON values -- pipe through `jq` for formatted output.

**Example:**

```bash
# Follow a stream (Ctrl+C to stop)
durable-stream read my-stream

# Pipe stream output to a file
durable-stream read my-stream > output.txt

# Pretty-print JSON stream output
durable-stream read my-stream | jq .
```

### `delete` -- Delete a stream

```bash
durable-stream delete <stream_id>
```

**Example:**

```bash
durable-stream delete my-stream
```

## Authentication

Use the `--auth` flag or the `STREAM_AUTH` environment variable to set the `Authorization` header. The value is sent as-is, so include the scheme (e.g., `Bearer`, `Basic`).

```bash
# Using an environment variable
export STREAM_AUTH="Bearer my-token"
durable-stream read my-stream

# Using the --auth flag (overrides the environment variable)
durable-stream --auth "Bearer my-token" read my-stream

# Other auth schemes work too
durable-stream --auth "Basic dXNlcjpwYXNz" read my-stream
```

## Workflow example

A complete session using the CLI, assuming a server is running on `localhost:4437` (see [Quickstart](quickstart)):

```bash
export STREAM_URL=http://localhost:4437/v1/stream

# Create a JSON stream
durable-stream create chat --json

# In another terminal, start following the stream
durable-stream read chat

# Back in the first terminal, write messages
durable-stream write chat '{"user": "alice", "text": "Hello!"}' --json
durable-stream write chat '{"user": "bob", "text": "Hi there!"}' --json

# Pipe data in
echo '{"user": "alice", "text": "How are you?"}' | durable-stream write chat --json

# Clean up
durable-stream delete chat
```
