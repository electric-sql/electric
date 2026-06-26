#!/usr/bin/env node
'use strict'
const path = require(`node:path`)
const { execFileSync } = require(`node:child_process`)

const targets = require(`../targets.json`)
const key = `${process.platform}-${process.arch}`
const target = targets.find((t) => t.node === key)

if (!target) {
  const supported = targets.map((t) => t.node).join(`, `)
  console.error(
    `durable-streams-server: unsupported platform "${key}". Supported: ${supported}.`
  )
  process.exit(1)
}

let binary
try {
  // Resolve via package.json (always resolvable) then join the known binary path.
  const pkgJson = require.resolve(`${target.pkg}/package.json`)
  binary = path.join(path.dirname(pkgJson), `bin`, `durable-streams-server`)
} catch {
  console.error(
    `durable-streams-server: the platform package "${target.pkg}" is not installed.\n` +
      `It should have been installed automatically as an optional dependency. ` +
      `If you used --no-optional or --ignore-optional, reinstall without it.`
  )
  process.exit(1)
}

try {
  execFileSync(binary, process.argv.slice(2), { stdio: `inherit` })
} catch (err) {
  // execFileSync throws on non-zero exit; mirror the child's exit code.
  process.exit(typeof err.status === `number` ? err.status : 1)
}
