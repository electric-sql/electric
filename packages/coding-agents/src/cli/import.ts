#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { stat, access, realpath } from 'node:fs/promises'
import { findSessionPath } from 'agent-session-protocol'
import type { AgentType } from 'agent-session-protocol'
import os from 'node:os'
import path from 'node:path'

export interface RunImportCliOptions {
  argv: Array<string>
  homeDir?: string
  fetchFn?: typeof fetch
}

export interface RunImportCliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function sanitiseCwd(p: string): string {
  return p.replace(/\//g, `-`)
}

function slugifyForName(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_.-]/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^[-_.]+/, ``)
    .replace(/[-_.]+$/, ``)
}

async function locateSessionFile(
  agent: AgentType,
  workspace: string,
  sessionId: string,
  homeDir: string
): Promise<{ path: string } | { error: string }> {
  if (agent === `claude`) {
    const real = await realpath(workspace)
    const p = path.join(
      homeDir,
      `.claude`,
      `projects`,
      sanitiseCwd(real),
      `${sessionId}.jsonl`
    )
    try {
      await access(p)
      return { path: p }
    } catch {
      return { error: `session JSONL not found at ${p}` }
    }
  }
  // codex: use asp's scanner since the path embeds a wall-clock timestamp.
  const found = await findSessionPath(`codex`, sessionId)
  if (!found)
    return {
      error: `codex session ${sessionId} not found under ${homeDir}/.codex/sessions`,
    }
  return { path: found }
}

export async function runImportCli(
  opts: RunImportCliOptions
): Promise<RunImportCliResult> {
  const { values } = parseArgs({
    args: opts.argv,
    options: {
      agent: { type: `string` },
      workspace: { type: `string` },
      'session-id': { type: `string` },
      'agent-id': { type: `string` },
      server: { type: `string` },
    },
    allowPositionals: false,
  })

  const agentRaw = values.agent ?? `claude`
  if (agentRaw !== `claude` && agentRaw !== `codex`) {
    return {
      exitCode: 2,
      stdout: ``,
      stderr: `--agent must be 'claude' or 'codex'; got ${JSON.stringify(agentRaw)}\n`,
    }
  }
  const agent: AgentType = agentRaw

  const workspace = values.workspace
  const sessionId = values[`session-id`]
  if (!workspace || !sessionId) {
    return {
      exitCode: 2,
      stdout: ``,
      stderr: `usage: electric-ax-import [--agent claude|codex] --workspace <path> --session-id <id> [--agent-id <name>] [--server <url>]\n`,
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `--session-id must be alphanumeric (with - or _); got ${JSON.stringify(sessionId)}\n`,
    }
  }

  const home = opts.homeDir ?? os.homedir()
  const fetchFn = opts.fetchFn ?? fetch

  // Validate workspace exists.
  try {
    const s = await stat(workspace)
    if (!s.isDirectory()) {
      return {
        exitCode: 1,
        stdout: ``,
        stderr: `workspace is not a directory: ${workspace}\n`,
      }
    }
  } catch {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `workspace not accessible: ${workspace}\n`,
    }
  }

  const located = await locateSessionFile(agent, workspace, sessionId, home)
  if (`error` in located) {
    return { exitCode: 1, stdout: ``, stderr: `${located.error}\n` }
  }

  const agentName = values[`agent-id`] ?? `import-${slugifyForName(sessionId)}`
  const server = values.server ?? `http://localhost:4437`
  const url = `${server.replace(/\/$/, ``)}/coding-agent/${agentName}`

  const body = {
    kind: agent,
    target: `host`,
    workspaceType: `bindMount`,
    workspaceHostPath: workspace,
    importNativeSessionId: sessionId,
  }

  const res = await fetchFn(url, {
    method: `PUT`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => ``)
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `spawn request failed: ${res.status} ${text}\n`,
    }
  }

  return {
    exitCode: 0,
    stdout: `imported as /coding-agent/${agentName}\n`,
    stderr: ``,
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith(`import.js`)
if (isMain) {
  runImportCli({ argv: process.argv.slice(2) }).then(
    (r) => {
      if (r.stdout) process.stdout.write(r.stdout)
      if (r.stderr) process.stderr.write(r.stderr)
      process.exit(r.exitCode)
    },
    (err) => {
      process.stderr.write(`unexpected error: ${err}\n`)
      process.exit(1)
    }
  )
}
