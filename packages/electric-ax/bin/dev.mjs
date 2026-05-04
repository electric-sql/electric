#!/usr/bin/env node

/**
 * dev.mjs — Host-mode dev script for the electric-ax / coding-agents stack.
 *
 * Usage (from the repo root):
 *   node packages/electric-ax/bin/dev.mjs up                    # start all services
 *   node packages/electric-ax/bin/dev.mjs down                  # stop all services
 *   node packages/electric-ax/bin/dev.mjs down --remove-volumes # also drop pg/electric volumes
 *   node packages/electric-ax/bin/dev.mjs clear-state           # down + wipe ALL local state
 *                                                               #   (postgres, electric, every
 *                                                               #    coding-agent-* workspace volume,
 *                                                               #    every sandbox container)
 *   node packages/electric-ax/bin/dev.mjs restart               # down + up
 *
 * What runs in Docker (postgres + electric only):
 *   postgres  → host port 54321  (or ELECTRIC_AGENTS_POSTGRES_HOST_PORT)
 *   electric  → host port 3000   (or ELECTRIC_AGENTS_ELECTRIC_HOST_PORT)
 *
 * What runs on the host for fast iteration (watch mode):
 *   agents-server    → http://localhost:4437  (tsx --watch on entrypoint.ts)
 *   agents-server-ui → served from agents-server static handler (vite build --watch)
 *   agents handler   → http://localhost:4448  (Horton, worker, coding-agent)
 *
 * Required env vars (set in shell, ~/.env, or .env at repo root / package root):
 *   ANTHROPIC_API_KEY — required for claude coding-agents
 *   OPENAI_API_KEY    — required for codex coding-agents
 *   (at least one of the two must be set; both is fine)
 *
 * Optional overrides:
 *   DATABASE_URL                       Postgres connection string
 *                                      (default: postgres://electric_agents:electric_agents@localhost:54321/electric_agents)
 *   ELECTRIC_AGENTS_ELECTRIC_URL       Electric service URL (default: http://localhost:3000)
 *   ELECTRIC_AGENTS_PORT               agents-server port (default: 4437)
 *   ELECTRIC_AGENTS_BUILTIN_PORT       built-in handler port (default: 4448)
 *   ELECTRIC_AGENTS_POSTGRES_HOST_PORT postgres host port (default: 54321)
 *   ELECTRIC_AGENTS_ELECTRIC_HOST_PORT electric host port (default: 3000)
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = resolve(__dirname, `..`, `..`, `..`)
const PACKAGE_ROOT = resolve(__dirname, `..`)
const AGENTS_SERVER_DIR = resolve(REPO_ROOT, `packages`, `agents-server`)
const AGENTS_SERVER_UI_DIR = resolve(REPO_ROOT, `packages`, `agents-server-ui`)
const DEV_COMPOSE_FILE = resolve(PACKAGE_ROOT, `docker-compose.dev.yml`)

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

const RESET = `\x1b[0m`
const BOLD = `\x1b[1m`
const colours = {
  docker: `\x1b[36m`, // cyan
  server: `\x1b[32m`, // green
  ui: `\x1b[35m`, // magenta
  handler: `\x1b[33m`, // yellow
  err: `\x1b[31m`, // red
  info: `\x1b[90m`, // grey
}

function prefix(label, colour) {
  return `${colour}${BOLD}[${label}]${RESET} `
}

function log(label, colour, msg) {
  process.stdout.write(`${prefix(label, colour)}${msg}\n`)
}

// ─── .env loader ─────────────────────────────────────────────────────────────

/**
 * Load a .env file into an object. Returns {} if the file doesn't exist.
 * Supports KEY=VALUE, quoted values, and inline comments.
 */
function loadDotEnv(filePath) {
  try {
    const content = readFileSync(filePath, `utf8`)
    const values = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(`#`)) continue
      const eqIdx = trimmed.indexOf(`=`)
      if (eqIdx <= 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if (
        (value.startsWith(`"`) && value.endsWith(`"`)) ||
        (value.startsWith(`'`) && value.endsWith(`'`))
      ) {
        value = value.slice(1, -1)
      } else {
        const hashIdx = value.indexOf(`#`)
        if (hashIdx !== -1) value = value.slice(0, hashIdx).trim()
      }
      values[key] = value
    }
    return values
  } catch {
    return {}
  }
}

// ─── env resolution ───────────────────────────────────────────────────────────

/**
 * Build the effective env for host services by merging (lowest → highest prio):
 *   1. .env at repo root (if any)
 *   2. .env at electric-ax package root (if any)
 *   3. process.env
 *
 * Returns a plain object that can be passed directly to child_process.spawn.
 */
function buildEnv() {
  const fileEnvRepo = loadDotEnv(resolve(REPO_ROOT, `.env`))
  const fileEnvPkg = loadDotEnv(resolve(PACKAGE_ROOT, `.env`))
  const merged = { ...fileEnvRepo, ...fileEnvPkg, ...process.env }

  const pgPort = merged.ELECTRIC_AGENTS_POSTGRES_HOST_PORT?.trim() || `54321`
  const electricPort =
    merged.ELECTRIC_AGENTS_ELECTRIC_HOST_PORT?.trim() || `3000`
  const agentsServerPort = merged.ELECTRIC_AGENTS_PORT?.trim() || `4437`
  const builtinPort = merged.ELECTRIC_AGENTS_BUILTIN_PORT?.trim() || `4448`

  const databaseUrl =
    merged.DATABASE_URL?.trim() ||
    merged.ELECTRIC_AGENTS_DATABASE_URL?.trim() ||
    `postgres://electric_agents:electric_agents@localhost:${pgPort}/electric_agents`

  const electricUrl =
    merged.ELECTRIC_AGENTS_ELECTRIC_URL?.trim() ||
    merged.ELECTRIC_URL?.trim() ||
    `http://localhost:${electricPort}`

  const agentsServerUrl =
    merged.ELECTRIC_AGENTS_URL?.trim() || `http://localhost:${agentsServerPort}`

  return {
    // Pass everything from the environment so PATH, HOME, etc. are inherited
    ...merged,

    // Resolved values that agents-server reads (entrypoint-lib.ts)
    DATABASE_URL: databaseUrl,
    ELECTRIC_AGENTS_DATABASE_URL: databaseUrl,
    ELECTRIC_AGENTS_ELECTRIC_URL: electricUrl,
    ELECTRIC_AGENTS_PORT: agentsServerPort,
    ELECTRIC_AGENTS_HOST: `0.0.0.0`,
    ELECTRIC_AGENTS_BASE_URL: agentsServerUrl,

    // Persist the embedded durable-streams server's data across host
    // process restarts. Without this, dev.mjs spawns a fresh
    // DurableStreamTestServer on each `up`, which forgets every existing
    // stream — and any pre-existing entity row in postgres ends up with
    // a 404 'Stream not found' on its /main path. Co-locating with
    // `.local/` keeps it out of git and easy to wipe via `clear-state`.
    ELECTRIC_AGENTS_STREAMS_DATA_DIR:
      merged.ELECTRIC_AGENTS_STREAMS_DATA_DIR?.trim() ||
      resolve(REPO_ROOT, `.local`, `dev-streams`),

    // For the built-in agent handler (bootstrap.ts / start.ts)
    ELECTRIC_AGENTS_BUILTIN_PORT: builtinPort,
    ELECTRIC_AGENTS_BUILTIN_HOST:
      merged.ELECTRIC_AGENTS_BUILTIN_HOST?.trim() || `0.0.0.0`,
    // start.ts reads ELECTRIC_AGENTS_URL as the agents-server URL
    ELECTRIC_AGENTS_URL: agentsServerUrl,

    // docker compose overrides
    ELECTRIC_AGENTS_POSTGRES_HOST_PORT: pgPort,
    ELECTRIC_AGENTS_ELECTRIC_HOST_PORT: electricPort,
    ELECTRIC_IMAGE_TAG: merged.ELECTRIC_IMAGE_TAG || `latest`,
    COMPOSE_PROJECT_NAME:
      merged.ELECTRIC_AGENTS_DEV_COMPOSE_PROJECT?.trim() ||
      `electric-agents-dev`,

    // Internal: resolved port numbers for logging
    _pgPort: pgPort,
    _electricPort: electricPort,
    _agentsServerPort: agentsServerPort,
    _builtinPort: builtinPort,
  }
}

// ─── port availability check ──────────────────────────────────────────────────

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once(`error`, () => resolve(false))
    server.once(`listening`, () => {
      server.close(() => resolve(true))
    })
    server.listen(Number(port), `127.0.0.1`)
  })
}

async function assertPortsFree(env) {
  const checks = [
    {
      port: env._agentsServerPort,
      name: `agents-server`,
      hint: `ELECTRIC_AGENTS_PORT`,
    },
    {
      port: env._builtinPort,
      name: `agents-handler`,
      hint: `ELECTRIC_AGENTS_BUILTIN_PORT`,
    },
    {
      port: env._pgPort,
      name: `postgres`,
      hint: `ELECTRIC_AGENTS_POSTGRES_HOST_PORT`,
    },
    {
      port: env._electricPort,
      name: `electric`,
      hint: `ELECTRIC_AGENTS_ELECTRIC_HOST_PORT`,
    },
  ]

  const collisions = []
  for (const { port, name, hint } of checks) {
    const free = await isPortFree(port)
    if (!free)
      collisions.push(`  port ${port} is in use — ${name} (override: ${hint})`)
  }

  if (collisions.length > 0) {
    process.stderr.write(
      `${colours.err}${BOLD}Port collision — stop conflicting processes first:${RESET}\n` +
        collisions.map((c) => `${colours.err}${c}${RESET}`).join(`\n`) +
        `\n`
    )
    process.exit(1)
  }
}

// ─── process management ───────────────────────────────────────────────────────

const childProcesses = []

function spawnWithPrefix(label, colour, cmd, args, options = {}) {
  log(`dev`, colours.info, `  $ ${cmd} ${args.join(` `)}`)

  const child = spawn(cmd, args, {
    stdio: [`ignore`, `pipe`, `pipe`],
    ...options,
  })

  child.stdout?.on(`data`, (data) => {
    const lines = String(data).split(`\n`)
    for (const line of lines) {
      if (line.trim()) process.stdout.write(`${prefix(label, colour)}${line}\n`)
    }
  })

  child.stderr?.on(`data`, (data) => {
    const lines = String(data).split(`\n`)
    for (const line of lines) {
      if (line.trim()) {
        process.stderr.write(
          `${prefix(label, colour)}${colours.err}${line}${RESET}\n`
        )
      }
    }
  })

  child.on(`error`, (error) => {
    process.stderr.write(
      `${prefix(label, colour)}${colours.err}Process error: ${error.message}${RESET}\n`
    )
  })

  child.on(`exit`, (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(
        `${prefix(label, colour)}${colours.err}Exited with code ${code}${RESET}\n`
      )
    } else if (signal && signal !== `SIGTERM`) {
      log(label, colour, `Killed by signal ${signal}`)
    }
  })

  childProcesses.push(child)
  return child
}

// ─── tool resolution ──────────────────────────────────────────────────────────

function findBin(name, packageDir) {
  const local = join(packageDir, `node_modules`, `.bin`, name)
  const root = join(REPO_ROOT, `node_modules`, `.bin`, name)
  if (existsSync(local)) return local
  if (existsSync(root)) return root
  return name // fall back to PATH
}

// ─── docker compose helpers ───────────────────────────────────────────────────

function runDockerCompose(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      `docker`,
      [`compose`, `-f`, DEV_COMPOSE_FILE, ...args],
      { stdio: `inherit`, env }
    )
    child.on(`error`, reject)
    child.on(`exit`, (code) => {
      if (code === 0) resolve()
      else reject(new Error(`docker compose exited with code ${code}`))
    })
  })
}

// ─── health wait ─────────────────────────────────────────────────────────────

async function waitForHealth(url, timeoutMs = 90_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = ``
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/_electric/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) return
      lastError = `HTTP ${res.status}`
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out waiting for ${url}/_electric/health: ${lastError}`)
}

// ─── up ───────────────────────────────────────────────────────────────────────

async function up() {
  const env = buildEnv()

  // Pre-flight: at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY must be
  // set so the handler can spawn at least one kind of coding-agent.
  const fileEnvRepo = loadDotEnv(resolve(REPO_ROOT, `.env`))
  const fileEnvPkg = loadDotEnv(resolve(PACKAGE_ROOT, `.env`))
  const anthropicKey =
    env.ANTHROPIC_API_KEY?.trim() ||
    fileEnvRepo.ANTHROPIC_API_KEY?.trim() ||
    fileEnvPkg.ANTHROPIC_API_KEY?.trim()
  const openaiKey =
    env.OPENAI_API_KEY?.trim() ||
    fileEnvRepo.OPENAI_API_KEY?.trim() ||
    fileEnvPkg.OPENAI_API_KEY?.trim()

  if (!anthropicKey && !openaiKey) {
    process.stderr.write(
      `${colours.err}${BOLD}No coding-agent API key set.${RESET}\n` +
        `${colours.err}Set at least one of ANTHROPIC_API_KEY (claude) or OPENAI_API_KEY (codex)${RESET}\n` +
        `${colours.err}in your shell or .env at the repo root:${RESET}\n` +
        `${colours.err}  echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env${RESET}\n` +
        `${colours.err}  echo 'OPENAI_API_KEY=sk-proj-...' >> .env${RESET}\n\n`
    )
    process.exit(1)
  }

  if (!anthropicKey) {
    log(
      `dev`,
      colours.info,
      `ANTHROPIC_API_KEY not set — claude coding-agents will fail at run-time.`
    )
  }
  if (!openaiKey) {
    log(
      `dev`,
      colours.info,
      `OPENAI_API_KEY not set — codex coding-agents will fail at run-time.`
    )
  }

  log(`dev`, colours.info, `Checking required ports...`)
  await assertPortsFree(env)

  // ── 1. Docker: postgres + electric ───────────────────────────────────────
  log(`docker`, colours.docker, `Starting postgres + electric...`)
  await runDockerCompose([`up`, `-d`], env)
  log(
    `docker`,
    colours.docker,
    `postgres  → postgres://localhost:${env._pgPort}`
  )
  log(
    `docker`,
    colours.docker,
    `electric  → http://localhost:${env._electricPort}`
  )

  // ── 2. agents-server-ui: vite build --watch ───────────────────────────────
  //    The agents-server serves the UI from ../../agents-server-ui/dist
  //    (relative to its own src/ directory — see server.ts AGENT_UI_DIST_DIR).
  //    Running vite build --watch keeps the dist up-to-date whenever UI sources
  //    change without rebuilding Docker.
  //
  //    Full HMR: run `pnpm dev` inside packages/agents-server-ui separately and
  //    open the Vite dev server URL directly. The agents-server static handler
  //    serves the last-built dist in the meantime.
  const viteBin = findBin(`vite`, AGENTS_SERVER_UI_DIR)
  log(`dev`, colours.info, `Starting agents-server-ui (vite build --watch)...`)
  spawnWithPrefix(`ui`, colours.ui, viteBin, [`build`, `--watch`], {
    cwd: AGENTS_SERVER_UI_DIR,
    env,
  })

  // ── 3. agents-server: tsx --watch ────────────────────────────────────────
  const tsxBin = findBin(`tsx`, AGENTS_SERVER_DIR)
  const serverEntrypoint = resolve(AGENTS_SERVER_DIR, `src`, `entrypoint.ts`)
  log(`dev`, colours.info, `Starting agents-server (tsx --watch)...`)
  spawnWithPrefix(
    `server`,
    colours.server,
    tsxBin,
    [`--watch`, serverEntrypoint],
    { cwd: AGENTS_SERVER_DIR, env }
  )

  log(`server`, colours.server, `Waiting for agents-server to be healthy...`)
  await waitForHealth(`http://localhost:${env._agentsServerPort}`)
  log(
    `server`,
    colours.server,
    `ready → http://localhost:${env._agentsServerPort}`
  )

  // ── 4. Built-in agents handler: electric-dev.mjs agents start-builtin ────
  //    Pre-flight verified at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY
  //    is set; both flow through `env`. The handler registers Horton, worker,
  //    and coding-agent entity types with the agents-server, then listens for
  //    wake webhooks on port 4448.
  const electricDevBin = resolve(__dirname, `electric-dev.mjs`)
  log(
    `dev`,
    colours.info,
    `Starting agents handler (Horton, worker, coding-agent)...`
  )
  spawnWithPrefix(
    `handler`,
    colours.handler,
    process.execPath,
    [electricDevBin, `agents`, `start-builtin`],
    { cwd: REPO_ROOT, env }
  )

  // ── Summary ───────────────────────────────────────────────────────────────
  log(`dev`, colours.info, ``)
  log(`dev`, colours.info, `${BOLD}All services started:${RESET}`)
  log(
    `dev`,
    colours.info,
    `  postgres      → postgres://electric_agents:electric_agents@localhost:${env._pgPort}/electric_agents`
  )
  log(
    `dev`,
    colours.info,
    `  electric      → http://localhost:${env._electricPort}`
  )
  log(
    `dev`,
    colours.info,
    `  agents-server → http://localhost:${env._agentsServerPort}`
  )
  log(
    `dev`,
    colours.info,
    `  agents-ui     → http://localhost:${env._agentsServerPort}/__agent_ui/`
  )
  log(
    `dev`,
    colours.info,
    `  handler       → http://localhost:${env._builtinPort} (webhook endpoint)`
  )
  log(`dev`, colours.info, ``)
  log(`dev`, colours.info, `Press Ctrl-C to stop all services.`)
  log(`dev`, colours.info, ``)

  // ── Shutdown on signal ────────────────────────────────────────────────────
  const shutdown = async () => {
    log(`dev`, colours.info, `Shutting down...`)
    for (const child of childProcesses) {
      try {
        child.kill(`SIGTERM`)
      } catch {}
    }
    try {
      await runDockerCompose([`stop`], env)
    } catch {}
    process.exit(0)
  }

  process.on(`SIGINT`, () => void shutdown())
  process.on(`SIGTERM`, () => void shutdown())

  // Block until Ctrl-C
  await new Promise(() => {})
}

// ─── down ─────────────────────────────────────────────────────────────────────

async function down(opts = {}) {
  const env = buildEnv()
  const removeVolumes = opts.removeVolumes === true

  log(`dev`, colours.info, `Stopping Docker services...`)
  const composeDownArgs = removeVolumes
    ? [`down`, `--volumes`, `--remove-orphans`]
    : [`down`]
  await runDockerCompose(composeDownArgs, env)
  log(`dev`, colours.info, `Docker services stopped.`)

  // Kill any host-side processes still listening on the managed ports
  const portsByName = {
    [env._agentsServerPort]: `agents-server`,
    [env._builtinPort]: `agents-handler`,
  }
  for (const [port, name] of Object.entries(portsByName)) {
    const free = await isPortFree(port)
    if (!free) {
      try {
        const { execSync } = await import(`node:child_process`)
        execSync(`lsof -ti :${port} | xargs -r kill -TERM 2>/dev/null`, {
          shell: true,
        })
        log(`dev`, colours.info, `Stopped ${name} on port ${port}`)
      } catch {
        // best-effort — not fatal
      }
    }
  }
}

// ─── clear-state ──────────────────────────────────────────────────────────────
//
// Stops everything and wipes ALL local state:
//   - Compose volumes (postgres data, electric WAL state)
//   - Per-agent workspace volumes created by LocalDockerProvider
//     (named `coding-agent-workspace-*`)
//   - Sandbox containers labeled `electric-ax.agent-id=*`
//   - Test stragglers from the conformance suite (`electric-ax-test-*`)
//
// After this, `up` brings the stack back with a fresh database and no
// orphan coding-agent entities in the sidebar.

async function clearState() {
  await down({ removeVolumes: true })

  const { execSync } = await import(`node:child_process`)

  const tryDocker = (cmd, label) => {
    try {
      const out = execSync(cmd, {
        shell: true,
        stdio: [`ignore`, `pipe`, `pipe`],
      })
        .toString()
        .trim()
      if (out) {
        const n = out.split(`\n`).filter(Boolean).length
        log(`dev`, colours.info, `Removed ${n} ${label}`)
      } else {
        log(`dev`, colours.info, `No ${label} to remove`)
      }
    } catch {
      // best-effort — not fatal (e.g. Docker not running)
    }
  }

  // Sandbox containers (LocalDockerProvider labels each container).
  tryDocker(
    `docker ps -aq --filter 'label=electric-ax.agent-id' | xargs -r docker rm -f`,
    `electric-ax-labeled containers`
  )

  // Per-agent workspace volumes.
  tryDocker(
    `docker volume ls --format '{{.Name}}' | grep -E '^coding-agent-' | xargs -r docker volume rm`,
    `coding-agent-* volumes`
  )

  // Conformance test stragglers (from test/integration/clone-workspace.test.ts).
  tryDocker(
    `docker volume ls --format '{{.Name}}' | grep -E '^electric-ax-test-' | xargs -r docker volume rm`,
    `electric-ax-test-* volumes`
  )

  // Embedded durable-streams data dir (set in buildEnv()). Wiping this
  // forces the next `up` to start with a clean stream registry, parallel
  // to dropping postgres volumes.
  try {
    const { rmSync } = await import(`node:fs`)
    const dataDir = resolve(REPO_ROOT, `.local`, `dev-streams`)
    rmSync(dataDir, { recursive: true, force: true })
    log(`dev`, colours.info, `Wiped durable-streams data dir: ${dataDir}`)
  } catch (err) {
    log(
      `dev`,
      colours.warning,
      `Failed to wipe streams data dir: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  log(`dev`, colours.info, `Local state cleared.`)
}

// ─── restart ──────────────────────────────────────────────────────────────────

async function restart() {
  await down()
  await up()
}

// ─── main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2]
const flags = process.argv.slice(3)

if (!cmd || ![`up`, `down`, `restart`, `clear-state`].includes(cmd)) {
  process.stderr.write(`
Usage: node packages/electric-ax/bin/dev.mjs <command>

Commands:
  up           Start postgres + electric in Docker; run agents-server, agents-server-ui,
               and the built-in agent handler (Horton, worker, coding-agent) on the host.
  down         Stop Docker services and kill host processes started by this script.
               Pass --remove-volumes to also drop postgres/electric volumes.
  clear-state  down --remove-volumes plus: wipe per-agent workspace volumes
               (coding-agent-*), labeled sandbox containers, and conformance test
               stragglers (electric-ax-test-*). After this 'up' brings up a clean
               slate with no orphan entities in the UI sidebar.
  restart      down + up.

Required env (at least one):
  ANTHROPIC_API_KEY   Required for claude coding-agents (and Horton/worker).
  OPENAI_API_KEY      Required for codex coding-agents.
                      Set in your shell or add to .env at the repo root.

Optional overrides (shell env or .env):
  DATABASE_URL                       Postgres connection string
  ELECTRIC_AGENTS_ELECTRIC_URL       Electric service URL (default: http://localhost:3000)
  ELECTRIC_AGENTS_PORT               agents-server port (default: 4437)
  ELECTRIC_AGENTS_BUILTIN_PORT       built-in handler port (default: 4448)
  ELECTRIC_AGENTS_POSTGRES_HOST_PORT postgres host port (default: 54321)
  ELECTRIC_AGENTS_ELECTRIC_HOST_PORT electric host port (default: 3000)
`)
  process.exit(1)
}

try {
  if (cmd === `up`) await up()
  else if (cmd === `down`)
    await down({ removeVolumes: flags.includes(`--remove-volumes`) })
  else if (cmd === `clear-state`) await clearState()
  else if (cmd === `restart`) await restart()
} catch (error) {
  process.stderr.write(
    `\n${colours.err}${BOLD}Fatal:${RESET} ${colours.err}${error instanceof Error ? error.message : String(error)}${RESET}\n`
  )
  process.exit(1)
}
