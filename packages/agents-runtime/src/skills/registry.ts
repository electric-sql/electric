import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { runtimeLog } from '../log'
import { extractSkillMeta } from './extract-meta'
import type { SkillMeta, SkillsRegistry } from './types'

const CACHE_FILENAME = `skills-cache.json`

interface SkillsRegistryOptions {
  baseSkillsDir: string
  appSkillsDir?: string
  appSkillsDirs?: ReadonlyArray<string>
  cacheDir: string
}

type CacheFile = Record<string, SkillMeta>
type SkillFile = { source: string; userInvocableByDefault: boolean }

export async function createSkillsRegistry(
  opts: SkillsRegistryOptions
): Promise<SkillsRegistry> {
  const { baseSkillsDir, appSkillsDir, appSkillsDirs, cacheDir } = opts

  const cachePath = path.join(cacheDir, CACHE_FILENAME)
  const existingCache = await loadCache(cachePath)

  const files = new Map<string, SkillFile>()
  await scanDir(baseSkillsDir, files, { userInvocableByDefault: false })
  if (appSkillsDir) {
    await scanDir(appSkillsDir, files, { userInvocableByDefault: true })
  }
  for (const dir of appSkillsDirs ?? []) {
    await scanDir(dir, files, { userInvocableByDefault: true })
  }

  const catalog = new Map<string, SkillMeta>()
  for (const [name, file] of files) {
    const filePath = file.source
    const content = await fs.readFile(filePath, `utf-8`)
    const hash = sha256(content)

    const cached = existingCache[name]
    if (cached && cached.contentHash === hash && cached.source === filePath) {
      catalog.set(name, cached)
      continue
    }

    runtimeLog.info(`[skills]`, `extracting metadata for "${name}"`)
    const meta = await extractSkillMeta(name, content)
    const entry: SkillMeta = {
      name,
      ...meta,
      userInvocable: meta.userInvocable ?? file.userInvocableByDefault,
      charCount: content.length,
      contentHash: hash,
      source: filePath,
    }
    catalog.set(name, entry)
  }

  await saveCache(cachePath, catalog, cacheDir)

  return {
    catalog,
    renderCatalog(budget?: number) {
      if (catalog.size === 0) return ``
      const skills = Array.from(catalog.values())

      // Phase 1: full detail
      const full = renderSkillList(skills, `full`)
      if (!budget || full.length <= budget) return full

      // Phase 2: compact (truncated descriptions, no keywords)
      const compact = renderSkillList(skills, `compact`)
      if (compact.length <= budget) return compact

      // Phase 3: names only
      return renderSkillList(skills, `names`)
    },
    async readContent(name: string) {
      const meta = catalog.get(name)
      if (!meta) return null
      try {
        return await fs.readFile(meta.source, `utf-8`)
      } catch {
        return null
      }
    },
  }
}

async function scanDir(
  dir: string,
  out: Map<string, SkillFile>,
  opts: { userInvocableByDefault: boolean }
) {
  let entries: Array<{
    name: string
    isFile: () => boolean
    isDirectory: () => boolean
  }>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const entryPath = path.resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === `node_modules` || entry.name === `.git`) continue
      await scanDir(entryPath, out, opts)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(`.md`)) continue
    const parsed = path.parse(entryPath)
    const name =
      parsed.name === `SKILL` ? path.basename(parsed.dir) : parsed.name
    out.set(name, {
      source: entryPath,
      userInvocableByDefault: opts.userInvocableByDefault,
    })
  }
}

async function loadCache(cachePath: string): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(cachePath, `utf-8`)
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveCache(
  cachePath: string,
  catalog: Map<string, SkillMeta>,
  cacheDir: string
) {
  const obj: CacheFile = {}
  for (const [name, meta] of catalog) {
    obj[name] = meta
  }
  fsSync.mkdirSync(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, `.gitignore`), `*\n`, `utf-8`)
  await fs.writeFile(cachePath, JSON.stringify(obj, null, 2), `utf-8`)
}

function sha256(content: string): string {
  return createHash(`sha256`).update(content).digest(`hex`)
}

function renderSkillList(
  skills: Array<SkillMeta>,
  mode: `full` | `compact` | `names`
): string {
  const invocable = skills.filter((s) => s.userInvocable)
  const others = skills.filter((s) => !s.userInvocable)
  const lines = [`Available skills:`]

  if (invocable.length > 0 && mode !== `names`) {
    lines.push(`\nUser-invocable (the user can trigger these directly):`)
    for (const meta of invocable) {
      const hint = meta.argumentHint ? ` ${meta.argumentHint}` : ``
      lines.push(
        `- /${meta.name}${hint} — ${mode === `compact` ? truncate(meta.description, 100) : meta.description}`
      )
    }
    if (others.length > 0) lines.push(``)
  }

  const all =
    mode === `names`
      ? skills
      : others.length > 0
        ? others
        : invocable.length === 0
          ? skills
          : []
  for (const meta of all) {
    if (mode === `names`) {
      const prefix = meta.userInvocable ? `/${meta.name}` : meta.name
      lines.push(`- ${prefix}: ${truncate(meta.description, 60)}`)
      continue
    }
    lines.push(
      `- ${meta.name} (${meta.charCount.toLocaleString()} chars): ${mode === `compact` ? truncate(meta.description, 100) : meta.description}`
    )
    lines.push(`  Use when: ${meta.whenToUse}`)
    if (mode === `full`) {
      lines.push(`  Keywords: ${meta.keywords.join(`, `)}`)
    }
    if (meta.argumentHint) {
      lines.push(`  Usage: use_skill("${meta.name}", "${meta.argumentHint}")`)
    }
  }
  return lines.join(`\n`)
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 3) + `...`
}
