---
title: Deployment
description: >-
  How to deploy Durable Streams, including self-hosting with Caddy and running in production with Electric Cloud.
outline: [2, 3]
---

# Deployment

[Self-host with Caddy](#self-hosted-with-caddy) or run in production using [Electric&nbsp;Cloud](https://dashboard.electric-sql.cloud).

<HostedElectricCard />

## At a glance

| Server                                 | Language             | Best for                          |
| -------------------------------------- | -------------------- | --------------------------------- |
| Dev Server (`@durable-streams/server`) | Node.js / TypeScript | Development, testing, prototyping |
| Caddy Plugin                           | Go                   | Production deployments            |
| Electric                               | Hosted               | Managed production hosting        |

## Node server

The Node server in `@durable-streams/server` is the reference implementation for development, testing, CI, and embedded Node.js use cases.

Install it with:

```bash
npm install @durable-streams/server
```

Start it in-process:

```typescript
import { DurableStreamTestServer } from "@durable-streams/server"

const server = new DurableStreamTestServer({
  port: 4437,
  host: "127.0.0.1",
})

await server.start()
```

Use `dataDir` for file-backed local persistence, or omit it for the default in-memory mode.

### Storage options

**In-memory (default)** -- fast, ephemeral storage that resets on restart:

```typescript
const server = new DurableStreamTestServer({ port: 4437 })
```

**File-backed** -- persistent storage using log files and LMDB for metadata:

```typescript
const server = new DurableStreamTestServer({
  port: 4437,
  dataDir: "./data/streams",
})
```

### Configuration

| Option                  | Type                  | Default       | Description                                                |
| ----------------------- | --------------------- | ------------- | ---------------------------------------------------------- |
| `port`                  | `number`              | `4437`        | Port to listen on                                          |
| `host`                  | `string`              | `"127.0.0.1"` | Host to bind to                                            |
| `dataDir`               | `string`              | —             | Data directory for file-backed storage; omit for in-memory |
| `longPollTimeout`       | `number`              | `30000`       | Long-poll timeout in milliseconds                          |
| `onStreamCreated`       | `StreamLifecycleHook` | —             | Hook called when a stream is created                       |
| `onStreamDeleted`       | `StreamLifecycleHook` | —             | Hook called when a stream is deleted                       |
| `compression`           | `boolean`             | `true`        | Enable gzip/deflate compression                            |
| `cursorIntervalSeconds` | `number`              | `20`          | Cursor interval for CDN cache collapsing                   |

### Lifecycle hooks

```typescript
const server = new DurableStreamTestServer({
  port: 4437,
  onStreamCreated: (event) => {
    console.log(`Stream created: ${event.path} (${event.contentType})`)
  },
  onStreamDeleted: (event) => {
    console.log(`Stream deleted: ${event.path}`)
  },
})
```

### When to use

- Local development and prototyping
- Automated testing and CI
- Embedding a Durable Streams server in a Node.js application

Full documentation: [Dev Server README](https://github.com/durable-streams/durable-streams/blob/main/packages/server/README.md)

## Self-hosted with Caddy

The Caddy plugin is the recommended server for production.

### Installation

Install using the quick-install script:

```bash
curl -sSL https://raw.githubusercontent.com/durable-streams/durable-streams/main/packages/caddy-plugin/install.sh | sh
```

Or download a pre-built binary for your platform from [GitHub Releases](https://github.com/durable-streams/durable-streams/releases).

To build from source:

```bash
go build -o durable-streams-server ./cmd/caddy
```

### Quickstart

Run the server in dev mode with zero configuration:

```bash
durable-streams-server dev
```

This starts an in-memory server at `http://localhost:4437` with the stream endpoint at `/v1/stream/*`. No Caddyfile required.

### Production Caddyfile

For production, create a `Caddyfile` with persistent storage and your domain. Caddy automatically provisions and renews TLS certificates via Let's Encrypt:

```caddyfile
{
	admin off
}

streams.example.com {
	route /v1/stream/* {
		durable_streams {
			data_dir /var/lib/durable-streams/data
		}
	}
}
```

To listen on a specific port without automatic TLS (e.g. behind a load balancer):

```caddyfile
{
	admin off
}

:4437 {
	route /v1/stream/* {
		durable_streams {
			data_dir ./data
		}
	}
}
```

Start the server:

```bash
durable-streams-server run --config Caddyfile
```

### Configuration reference

All configuration directives for the `durable_streams` block:

| Directive                | Default               | Description                                                  |
| ------------------------ | --------------------- | ------------------------------------------------------------ |
| `data_dir`               | _(none -- in-memory)_ | Path to persistent storage directory (LMDB)                  |
| `long_poll_timeout`      | `30s`                 | How long the server holds long-poll connections open         |
| `sse_reconnect_interval` | `60s`                 | How often SSE connections are closed for CDN collapsing      |
| `max_file_handles`       | `100`                 | Maximum number of cached open file handles (file store only) |

Example with all options:

```caddyfile
route /v1/stream/* {
	durable_streams {
		data_dir ./data
		long_poll_timeout 30s
		sse_reconnect_interval 120s
		max_file_handles 200
	}
}
```

### Authentication

The protocol leaves authentication out of scope -- use Caddy's native mechanisms. Here are common patterns:

**Bearer token with forward auth** (recommended for production):

```caddyfile
api.example.com {
	route /v1/stream/* {
		forward_auth localhost:3001 {
			uri /auth/verify
			copy_headers Authorization
		}
		durable_streams {
			data_dir ./data
		}
	}
}
```

**Static API key** (simple, good for internal services):

```caddyfile
api.example.com {
	@unauthorized {
		not header Authorization "Bearer my-secret-key"
	}
	route /v1/stream/* {
		respond @unauthorized 401
		durable_streams {
			data_dir ./data
		}
	}
}
```

See Caddy's [authentication documentation](https://caddyserver.com/docs/caddyfile/directives/forward_auth) for more options including basic auth, JWT validation, and OAuth2 integration.

### Reverse proxy

Caddy has built-in reverse proxy support. You can combine Durable Streams with proxied routes in the same Caddyfile:

```caddyfile
api.example.com {
	route /v1/stream/* {
		durable_streams {
			data_dir ./data
		}
	}

	route /api/* {
		reverse_proxy localhost:3000
	}
}
```

### Running as a service

**systemd:**

```ini
[Unit]
Description=Durable Streams Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/durable-streams-server run --config /etc/durable-streams/Caddyfile
Restart=always
RestartSec=5
User=durable-streams
Group=durable-streams

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable durable-streams
sudo systemctl start durable-streams
```

**Docker:**

```dockerfile
FROM debian:bookworm-slim
COPY durable-streams-server /usr/local/bin/
COPY Caddyfile /etc/durable-streams/Caddyfile
VOLUME /data
EXPOSE 4437
CMD ["durable-streams-server", "run", "--config", "/etc/durable-streams/Caddyfile"]
```

```bash
docker run -d -p 4437:4437 -v durable-streams-data:/data my-durable-streams
```

### Known limitations

**File store crash-atomicity.** The file-backed store does not atomically commit producer state with data appends. Data is written to segment files first, then producer state is updated separately. If a crash occurs between these steps, producer state may be stale on recovery.

The practical impact is low. The likely failure mode is a false `409` (sequence gap) on restart, not duplicate data. Clients can recover by incrementing their epoch. See [issue #143](https://github.com/durable-streams/durable-streams/issues/143) for details.

## Which server should I use?

- **Just getting started or developing locally?** Use the Node server in `@durable-streams/server`.
- **Deploying to production?** Use the Caddy plugin for self-hosted deployments, or [Electric Cloud](https://dashboard.electric-sql.cloud) for managed hosting.
- **Building your own server?** See [Building a server](building-a-server) for protocol implementation guidance.

## CDN integration

The Durable Streams protocol is designed for CDN-friendly fan-out. You don't need Electric Cloud to benefit from this -- the same properties apply when self-hosting behind any CDN.

**Cache-friendly historical reads.** Catch-up reads from a given offset return immutable content. A request for "everything after offset X" always returns the same response, making these requests safe to cache indefinitely at the edge.

**Cursor-based collapsing.** In live mode, multiple clients waiting at the same offset can be collapsed into fewer upstream connections by CDN edge nodes. This means read-heavy workloads scale horizontally without overwhelming origin servers.

**Conditional requests.** ETag support allows clients to make conditional requests, reducing unnecessary data transfer when content hasn't changed.

This architecture means a single origin server can serve a large number of concurrent readers through CDN fan-out, with the CDN absorbing the connection and bandwidth costs of the read path.

---

See also: [Core concepts](concepts) | [Quickstart](quickstart) | [Building a server](building-a-server)
