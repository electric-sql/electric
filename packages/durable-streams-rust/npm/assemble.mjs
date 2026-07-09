import {
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  rmSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function readJson(p) {
  return JSON.parse(readFileSync(p, `utf8`))
}

export function assemble({ version, binsDir, outDir }) {
  if (!version) throw new Error(`assemble: version is required`)
  const targets = readJson(join(here, `targets.json`))
  const mainTpl = readJson(join(here, `templates`, `main.package.json`))
  const platTpl = readJson(join(here, `templates`, `platform.package.json`))

  // Platform packages.
  const optionalDependencies = {}
  for (const t of targets) {
    const src = join(binsDir, t.rustTarget, `durable-streams-server`)
    if (!existsSync(src))
      throw new Error(`assemble: missing binary for ${t.rustTarget} at ${src}`)
    const pkgDir = join(outDir, t.rustTarget)
    rmSync(pkgDir, { recursive: true, force: true })
    mkdirSync(join(pkgDir, `bin`), { recursive: true })
    const dest = join(pkgDir, `bin`, `durable-streams-server`)
    copyFileSync(src, dest)
    chmodSync(dest, 0o755)

    const pj = { ...platTpl, name: t.pkg, version, os: [t.os], cpu: [t.cpu] }
    if (t.libc) pj.libc = [t.libc]
    writeFileSync(
      join(pkgDir, `package.json`),
      JSON.stringify(pj, null, 2) + `\n`
    )
    optionalDependencies[t.pkg] = version
  }

  // Main package.
  const mainDir = join(outDir, `main`)
  rmSync(mainDir, { recursive: true, force: true })
  mkdirSync(join(mainDir, `bin`), { recursive: true })
  copyFileSync(
    join(here, `bin`, `launcher.cjs`),
    join(mainDir, `bin`, `launcher.cjs`)
  )
  copyFileSync(join(here, `targets.json`), join(mainDir, `targets.json`))
  copyFileSync(join(here, `README.md`), join(mainDir, `README.md`))
  const mainPj = { ...mainTpl, version, optionalDependencies }
  writeFileSync(
    join(mainDir, `package.json`),
    JSON.stringify(mainPj, null, 2) + `\n`
  )

  return {
    mainDir,
    platformDirs: targets.map((t) => ({
      target: t,
      dir: join(outDir, t.rustTarget),
    })),
  }
}

// CLI: node assemble.mjs --version X.Y.Z --bins <dir> --out <dir>
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, ``)
    out[k] = argv[i + 1]
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2))
  const res = assemble({ version: a.version, binsDir: a.bins, outDir: a.out })
  // Print platform dirs first, main last — the publish order.
  for (const p of res.platformDirs) console.log(p.dir)
  console.log(res.mainDir)
}
