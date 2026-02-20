#!/usr/bin/env node

/**
 * Check if agent skills may be stale based on changed files in a PR.
 *
 * Parses SKILL.md frontmatter for `metadata.sources` and compares against
 * the list of changed files to identify potentially affected skills.
 *
 * Usage:
 *   node scripts/check-skill-staleness.mjs <changed-files.txt>
 *
 * Where changed-files.txt contains one file path per line (from git diff --name-only)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

/**
 * Parse YAML frontmatter from a SKILL.md file
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  const result = {}
  let currentKey = null
  let inArray = false
  let arrayItems = []

  for (const line of yaml.split('\n')) {
    // Check for array item
    if (line.match(/^\s+-\s+/)) {
      const value = line.replace(/^\s+-\s+/, '').trim()
      arrayItems.push(value)
      continue
    }

    // If we were collecting array items, save them
    if (inArray && currentKey && arrayItems.length > 0) {
      result[currentKey] = arrayItems
      arrayItems = []
      inArray = false
    }

    // Check for key: value or key:
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()

      if (value === '' || value === '|' || value === '>') {
        // Start of array or multiline
        currentKey = key
        inArray = true
      } else {
        result[key] = value.replace(/^["']|["']$/g, '')
      }
    }
  }

  // Handle trailing array
  if (inArray && currentKey && arrayItems.length > 0) {
    result[currentKey] = arrayItems
  }

  return result
}

/**
 * Extract metadata.sources from frontmatter
 */
function extractSources(frontmatter) {
  // Handle nested metadata.sources
  if (
    typeof frontmatter.metadata === 'object' &&
    frontmatter.metadata?.sources
  ) {
    return frontmatter.metadata.sources
  }

  // Try to find sources in raw parsing
  if (frontmatter.sources) {
    return Array.isArray(frontmatter.sources)
      ? frontmatter.sources
      : [frontmatter.sources]
  }

  return []
}

/**
 * Find all SKILL.md files in the repository
 */
function findSkillFiles() {
  const skillsDirs = [
    { dir: 'packages/playbook/skills', package: '@electric-sql/playbook' },
    {
      dir: 'packages/typescript-client/skills',
      package: '@electric-sql/client',
    },
  ]

  const skills = []

  for (const { dir, package: pkg } of skillsDirs) {
    const skillsDir = join(rootDir, dir)
    if (!existsSync(skillsDir)) continue

    for (const skillName of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, skillName, 'SKILL.md')
      if (existsSync(skillFile)) {
        skills.push({ name: skillName, path: skillFile, package: pkg })
      }
    }
  }

  return skills
}

/**
 * Check if a changed file matches any skill sources
 */
function matchesSource(changedFile, sources) {
  for (const source of sources) {
    // Exact match
    if (changedFile === source) return true

    // Partial match (source is a prefix or suffix)
    if (changedFile.includes(source) || source.includes(changedFile))
      return true

    // Glob-like match for directories
    if (source.includes('*')) {
      // Escape regex metacharacters, then replace * with .*
      const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      const pattern = escaped.replace(/\\\*/g, '.*')
      if (new RegExp(pattern).test(changedFile)) return true
    }
  }
  return false
}

/**
 * Main function
 */
function main() {
  const changedFilesArg = process.argv[2]

  if (!changedFilesArg) {
    console.log(
      'Usage: node scripts/check-skill-staleness.mjs <changed-files.txt>'
    )
    console.log('')
    console.log('Checks which skills may need updating based on changed files.')
    process.exit(0)
  }

  // Read changed files
  let changedFiles
  if (existsSync(changedFilesArg)) {
    changedFiles = readFileSync(changedFilesArg, 'utf-8')
      .split('\n')
      .filter(Boolean)
  } else {
    // Assume it's a comma-separated list
    changedFiles = changedFilesArg.split(',').filter(Boolean)
  }

  if (changedFiles.length === 0) {
    console.log('No changed files provided.')
    process.exit(0)
  }

  // Find all skills and their sources
  const skills = findSkillFiles()
  const affectedSkills = []

  for (const skill of skills) {
    try {
      const content = readFileSync(skill.path, 'utf-8')
      const frontmatter = parseFrontmatter(content)
      const sources = extractSources(frontmatter)

      if (sources.length === 0) continue

      const matchedSources = changedFiles.filter((f) =>
        matchesSource(f, sources)
      )

      if (matchedSources.length > 0) {
        affectedSkills.push({
          ...skill,
          sources,
          matchedSources,
        })
      }
    } catch (err) {
      console.error(`Error processing ${skill.path}: ${err.message}`)
    }
  }

  // Output results
  if (affectedSkills.length === 0) {
    console.log('No skills affected by these changes.')
    process.exit(0)
  }

  console.log('## Skills potentially affected by this PR\n')
  console.log(
    'The following skills reference source files that were modified:\n'
  )

  for (const skill of affectedSkills) {
    console.log(`### ${skill.name} (${skill.package})`)
    console.log(`- Path: \`${skill.path.replace(rootDir + '/', '')}\``)
    console.log(`- Modified sources:`)
    for (const source of skill.matchedSources) {
      console.log(`  - \`${source}\``)
    }
    console.log('')
  }

  console.log('---')
  console.log('**Action needed**: Review these skills and update if necessary.')
  console.log(
    'Run `npx @electric-sql/playbook show <name>` to view current content.'
  )

  // Exit with non-zero if skills are affected (for CI to detect)
  process.exit(1)
}

main()
