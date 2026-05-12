# Dev Script for Agents Services — Design

**Date:** 2026-05-12
**Status:** approved

## Goal

Provide a single script that starts, stops, builds, and tears down the Electric Agents dev environment described in `docs/agents-development.md`. Replace the current six-terminal manual flow with one command.

## Non-goals

- Auto-restart of `node entrypoint.js` processes when their `dist/` is rebuilt. If a user changes code in `agents-server` or `agents`, they re-run `./scripts/dev.sh build` (or restart manually). The script does not watch `dist/`.
- Custom log multiplexing/coloring. We rely on per-process log files plus `tail -F`.
- Replacing the `pnpm dev` watch in each package. Those already use tsdown/vite watch for source-to-`dist` rebuilds.

## CLI surface

```
./scripts/dev.sh <subcommand> [--detach]

  build       Install deps and run a one-shot build of all packages
              required by the agents stack. Run this before `start`
              on a fresh checkout, after pulling, or after changing
              code in agents-runtime, agents-server, or agents.

  start [--detach] [--with-agents]
              Bring up docker services + dev processes.
              Foreground by default (Ctrl-C stops everything).
              --detach        exits after spawning; processes keep running.
              --with-agents   also spawn the built-in agents (Horton + Worker)
                              after waiting for agents-server to bind :4437.
                              Without it, run them manually in a separate
                              terminal — the start banner prints the command.

  stop        Stop all dev processes (read PIDs from .dev-logs/) and
              `docker compose down`. Volumes preserved.

  teardown    Same as `stop`, plus `docker compose down -v`
              (removes the Postgres volume — wipes all agent state).

  status      Print which services are running and where their logs are.
```

`--detach` is only meaningful with `start`. Unknown subcommands print usage and exit non-zero.

## Services managed

Five processes plus one docker compose stack are always managed by `start`. A sixth (`agents`, the built-in Horton + Worker server) is opt-in via `--with-agents`.

| Name                  | Command                                                                                                                                   | Purpose                             | When                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------- |
| `docker`              | `docker compose -f packages/agents-server/docker-compose.dev.yml up -d`                                                                   | Postgres, Electric, Jaeger          | always               |
| `agents-server`       | `DATABASE_URL=… ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3060 ELECTRIC_INSECURE=true node packages/agents-server/dist/entrypoint.js` | Server on `localhost:4437`          | always               |
| `agents`              | `ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 node packages/agents/dist/entrypoint.js`                                                | Built-in agents on `localhost:4448` | only `--with-agents` |
| `agents-runtime`      | `pnpm -C packages/agents-runtime dev`                                                                                                     | tsdown watch                        | always               |
| `agents-server-build` | `pnpm -C packages/agents-server dev`                                                                                                      | tsdown watch                        | always               |
| `agents-build`        | `pnpm -C packages/agents dev`                                                                                                             | tsdown watch                        | always               |
| `agents-server-ui`    | `pnpm -C packages/agents-server-ui dev`                                                                                                   | Vite dev server (HMR)               | always               |

**Spawn order matters** because `tsdown --watch` cleans `dist/` on startup. `start` therefore spawns the long-lived entrypoints (`agents-server`, optionally `agents`) **first** so they load `dist/` into memory before the watchers clean it. The watchers come up afterwards and keep `dist/` fresh for subsequent restarts.

**Race between `agents` and `agents-server`:** the built-in agents register entity types against `agents-server` at startup; if they race ahead of it they fail with `Stream not found`. With `--with-agents`, `start` waits for `agents-server` to bind `:4437` (TCP poll, 60s timeout) before spawning `agents`. Without the flag, the operator runs them manually in a dedicated terminal after `start` has settled:

```sh
ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \
  node packages/agents/dist/entrypoint.js
```

The `start` banner prints this command when `--with-agents` is not set. Ctrl-C in that terminal stops only the built-in agents; the rest of the stack keeps running.

## Layout

```
scripts/
  dev.sh                     # the script (bash)
.dev-logs/                   # gitignored; created on demand
  docker.log
  agents-runtime.log
  agents-server-build.log
  agents-build.log
  agents-server.log
  agents-server-ui.log
  <name>.pid                 # one PID file per process (not docker)
```

## `build` behavior

```
pnpm install
pnpm -C packages/typescript-client build
pnpm -C packages/agents-runtime build
pnpm -C packages/agents-mcp build
pnpm -C packages/agents-server build
pnpm -C packages/agents build
```

The UI is not built — `agents-server-ui` runs under vite dev, which serves source directly.

If any step fails, the script exits non-zero and prints the failing command. No `.dev-logs/` involvement — output streams straight to the terminal.

## `start` behavior

1. **Preflight checks** (all fail loud):
   - `.env` exists at repo root and contains `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
   - `dist/` directories exist for `typescript-client`, `agents-runtime`, `agents-mcp`, `agents-server`, `agents`. If any are missing → print `run ./scripts/dev.sh build first` and exit 1.
   - `docker` daemon reachable (`docker info` quick check).
   - No existing `.dev-logs/*.pid` files for live processes. If found, suggest `./scripts/dev.sh stop` first.
2. `mkdir -p .dev-logs`
3. **Start docker** synchronously: `docker compose … up -d > .dev-logs/docker.log 2>&1`. Wait for it to return; bail if non-zero.
4. **Spawn 5 processes** in parallel. Each redirects stdout+stderr to `.dev-logs/<name>.log` and writes its PID to `.dev-logs/<name>.pid`. Pattern:
   ```sh
   ( <command> ) > .dev-logs/<name>.log 2>&1 &
   echo $! > .dev-logs/<name>.pid
   ```
5. **Foreground mode (default):**
   - Print: ports, log paths, "Ctrl-C to stop".
   - `trap 'stop_all; exit 0' INT TERM`
   - `exec tail -F .dev-logs/agents-runtime.log .dev-logs/agents-server-build.log .dev-logs/agents-build.log .dev-logs/agents-server.log .dev-logs/agents-server-ui.log` (Note: `tail -F` shows `==> file <==` headers between switches — fine for prefixing.)
6. **Detach mode (`--detach`):** print same summary, exit 0. Processes continue with their parent reparented to PID 1 (using `disown` after `&`).

## `stop` behavior

```
for f in .dev-logs/*.pid; do
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid"
  fi
done

# wait up to 5s for graceful exit, then SIGKILL stragglers
for _ in 1 2 3 4 5; do
  any_alive=false
  for f in .dev-logs/*.pid; do
    pid=$(cat "$f")
    if kill -0 "$pid" 2>/dev/null; then any_alive=true; fi
  done
  $any_alive || break
  sleep 1
done
for f in .dev-logs/*.pid; do
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
  rm -f "$f"
done

docker compose -f packages/agents-server/docker-compose.dev.yml down
```

## `teardown` behavior

`stop` logic, but the `docker compose down` uses `-v` to remove volumes, and `rm -rf .streams-data/` to wipe local durable-streams state. Both are dev-only state.

## `status` behavior

For each PID file, check `kill -0` and print `<name>: running (pid N)` or `not running`. Print docker status via `docker compose ps`.

## Error handling

- All preflight failures print a clear, actionable message and exit 1.
- Process spawn failures: the corresponding log file shows the error. `status` will report them as not running.
- The script does not attempt to recover failed processes — operator inspects logs and re-runs `start` after fixing.

## Testing

- Manual: `build`, `start`, observe `.dev-logs/`, Ctrl-C, verify all processes stopped (`status`), `start --detach`, `status`, `stop`, `teardown` removes volume.
- No automated tests — this is a developer tool whose surface is shell behavior.

## .gitignore

`.dev-logs/` and `.streams-data/` are gitignored.
