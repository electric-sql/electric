import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { glob } from 'glob'
import parseChangeset from '@changesets/parse'

const baseRef = process.env.GITHUB_BASE_REF
if (!baseRef) {
  console.error('GITHUB_BASE_REF environment variable is required')
  process.exit(2)
}

try {
  execSync(`git fetch --no-tags origin ${baseRef}`, { stdio: 'inherit' })
} catch (err) {
  console.error(`Failed to fetch base ref ${baseRef}: ${err.message}`)
  process.exit(2)
}

const base = `origin/${baseRef}`
const allChanged = gitDiff(base, '--diff-filter=ACMR')
const addedFiles = new Set(gitDiff(base, '--diff-filter=A'))

const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
const ignorePatterns = (config.ignore || []).map(globToRegex)

const packageMap = new Map()
for (const pkgPath of await glob('packages/*/package.json')) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const dir = pkgPath.replace(/package\.json$/, '')
  packageMap.set(dir, pkg.name)
}

const affected = new Set()
for (const file of allChanged) {
  for (const [dir, name] of packageMap) {
    if (file.startsWith(dir)) {
      if (!ignorePatterns.some((re) => re.test(name))) affected.add(name)
      break
    }
  }
}

const covered = new Set()
const changesetFiles = [...addedFiles].filter(
  (f) => /^\.changeset\/[^/]+\.md$/.test(f) && f !== '.changeset/README.md'
)
for (const file of changesetFiles) {
  let parsed
  try {
    parsed = parseChangeset(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`Failed to parse ${file}: ${err.message}`)
    process.exit(1)
  }
  for (const release of parsed.releases) covered.add(release.name)
}

if (affected.size === 0) {
  console.log('✅ No package files modified — changeset not required')
  process.exit(0)
}

const missing = [...affected].filter((p) => !covered.has(p))

if (missing.length > 0) {
  console.log('❌ Missing changeset entries for the following packages:')
  for (const name of missing) console.log(`   - ${name}`)
  console.log('')
  console.log(
    'This PR modifies files in those packages but no changeset file in'
  )
  console.log('.changeset/ covers them.')
  console.log('')
  console.log(
    'To fix: run `pnpm changeset`, select the affected packages, and commit'
  )
  console.log('the generated file in .changeset/.')
  process.exit(1)
}

console.log(
  `✅ Changesets cover all affected packages: ${[...affected].join(', ')}`
)

function gitDiff(base, filter) {
  const out = execSync(`git diff --name-only ${filter} ${base}...HEAD`, {
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function globToRegex(g) {
  const escaped = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}
