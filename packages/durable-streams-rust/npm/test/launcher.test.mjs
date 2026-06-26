import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const launcher = join(here, `..`, `bin`, `launcher.cjs`)
const targets = JSON.parse(
  readFileSync(join(here, `..`, `targets.json`), `utf8`)
)

function fakePlatformPackageRoot() {
  // Build node_modules/<pkg>/{package.json,bin/durable-streams-server} for THIS host.
  const hostKey = `${process.platform}-${process.arch}`
  const t = targets.find((t) => t.node === hostKey)
  assert.ok(t, `test host ${hostKey} not in targets.json`)
  const root = mkdtempSync(join(tmpdir(), `ds-npm-`))
  const pkgDir = join(root, `node_modules`, t.pkg)
  mkdirSync(join(pkgDir, `bin`), { recursive: true })
  writeFileSync(
    join(pkgDir, `package.json`),
    JSON.stringify({ name: t.pkg, version: `0.0.0` })
  )
  // A fake "binary" that is really a shell script: echoes args, exits 7.
  const bin = join(pkgDir, `bin`, `durable-streams-server`)
  writeFileSync(bin, `#!/bin/sh\necho "ARGS:$*"\nexit 7\n`)
  chmodSync(bin, 0o755)
  return root
}

test(`launcher execs the platform binary, forwards args, propagates exit code`, () => {
  const root = fakePlatformPackageRoot()
  let out = ``,
    code = 0
  try {
    out = execFileSync(`node`, [launcher, `--port`, `4438`], {
      env: { ...process.env, NODE_PATH: join(root, `node_modules`) },
      encoding: `utf8`,
    })
  } catch (e) {
    code = e.status
    out = e.stdout?.toString() ?? ``
  }
  assert.equal(code, 7, `exit code propagated`)
  assert.match(out, /ARGS:--port 4438/, `args forwarded`)
})

test(`launcher errors clearly when no platform package is installed`, () => {
  const empty = mkdtempSync(join(tmpdir(), `ds-npm-empty-`))
  let stderr = ``,
    code = 0
  try {
    execFileSync(`node`, [launcher], {
      env: { ...process.env, NODE_PATH: join(empty, `node_modules`) },
      encoding: `utf8`,
    })
  } catch (e) {
    code = e.status
    stderr = e.stderr?.toString() ?? ``
  }
  assert.notEqual(code, 0)
  assert.match(stderr, /platform package/i)
})
