import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble } from '../assemble.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const targets = JSON.parse(
  readFileSync(join(here, `..`, `targets.json`), `utf8`)
)

function makeBins() {
  const dir = mkdtempSync(join(tmpdir(), `ds-bins-`))
  for (const t of targets) {
    mkdirSync(join(dir, t.rustTarget), { recursive: true })
    writeFileSync(
      join(dir, t.rustTarget, `durable-streams-server`),
      `bin:${t.rustTarget}`
    )
  }
  return dir
}

test(`assemble produces main + 4 platform packages with stamped versions`, () => {
  const binsDir = makeBins()
  const outDir = mkdtempSync(join(tmpdir(), `ds-out-`))
  assemble({ version: `1.2.3`, binsDir, outDir })

  // main package
  const main = JSON.parse(
    readFileSync(join(outDir, `main`, `package.json`), `utf8`)
  )
  assert.equal(main.name, `@electric-ax/durable-streams-server-rust`)
  assert.equal(main.version, `1.2.3`)
  assert.equal(Object.keys(main.optionalDependencies).length, targets.length)
  for (const t of targets)
    assert.equal(main.optionalDependencies[t.pkg], `1.2.3`)
  assert.ok(existsSync(join(outDir, `main`, `bin`, `launcher.cjs`)))
  assert.ok(existsSync(join(outDir, `main`, `targets.json`)))
  assert.ok(existsSync(join(outDir, `main`, `README.md`)))

  // platform packages
  for (const t of targets) {
    const pj = JSON.parse(
      readFileSync(join(outDir, t.rustTarget, `package.json`), `utf8`)
    )
    assert.equal(pj.name, t.pkg)
    assert.equal(pj.version, `1.2.3`)
    assert.deepEqual(pj.os, [t.os])
    assert.deepEqual(pj.cpu, [t.cpu])
    if (t.libc) assert.deepEqual(pj.libc, [t.libc])
    else assert.equal(pj.libc, undefined)
    const binPath = join(outDir, t.rustTarget, `bin`, `durable-streams-server`)
    assert.ok(existsSync(binPath))
    assert.equal(readFileSync(binPath, `utf8`), `bin:${t.rustTarget}`)
    assert.ok(statSync(binPath).mode & 0o111, `binary is executable`)
  }
})

test(`assemble throws if a target binary is missing`, () => {
  const binsDir = mkdtempSync(join(tmpdir(), `ds-bins-empty-`))
  const outDir = mkdtempSync(join(tmpdir(), `ds-out-`))
  assert.throws(
    () => assemble({ version: `1.2.3`, binsDir, outDir }),
    /missing binary/i
  )
})
