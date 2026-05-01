#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { stat, access, realpath } from 'node:fs/promises'
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

export async function runImportCli(
  opts: RunImportCliOptions
): Promise<RunImportCliResult> {
  const { values } = parseArgs({
    args: opts.argv,
    options: {
      workspace: { type: `string` },
      'session-id': { type: `string` },
      'agent-id': { type: `string` },
      server: { type: `string` },
    },
    allowPositionals: false,
  })

  const workspace = values.workspace
  const sessionId = values[`session-id`]
  if (!workspace || !sessionId) {
    return {
      exitCode: 2,
      stdout: ``,
      stderr: `usage: electric-ax import-claude --workspace <path> --session-id <id> [--agent-id <name>] [--server <url>]\n`,
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

  // Validate workspace exists
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

  // Validate JSONL exists
  const real = await realpath(workspace)
  const sessionFile = path.join(
    home,
    `.claude`,
    `projects`,
    sanitiseCwd(real),
    `${sessionId}.jsonl`
  )
  try {
    await access(sessionFile)
  } catch {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `session JSONL not found at ${sessionFile}\n`,
    }
  }

  const agentName = values[`agent-id`] ?? `import-${slugifyForName(sessionId)}`
  const server = values.server ?? `http://localhost:4437`
  const url = `${server.replace(/\/$/, ``)}/coding-agent/${agentName}`

  const body = {
    kind: `claude`,
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

// Direct invocation entrypoint
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith(`import-claude.js`)
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
