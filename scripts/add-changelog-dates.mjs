#!/usr/bin/env node

/**
 * Post-processor script that adds release dates to CHANGELOG version headers.
 *
 * This script runs after `changeset version` and adds the current date to any
 * newly created version entries. It detects modified CHANGELOGs via git and
 * only adds dates to the topmost version header if it doesn't already have one.
 *
 * Output format: ## 1.0.0 (2024-01-15)
 *
 * Usage:
 *   node scripts/add-changelog-dates.mjs
 *
 * This is typically run as part of the ci:version script after changeset version.
 */

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

/**
 * Get the current date in YYYY-MM-DD format
 */
function getFormattedDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, `0`)
  const day = String(now.getDate()).padStart(2, `0`)
  return `${year}-${month}-${day}`
}

/**
 * Get list of modified CHANGELOG.md files from git
 */
function getModifiedChangelogs() {
  try {
    // Get both staged and unstaged modified files
    const output = execSync(`git diff --name-only HEAD`, {
      encoding: `utf-8`,
    }).trim()

    if (!output) {
      // Also check staged files
      const stagedOutput = execSync(`git diff --name-only --cached`, {
        encoding: `utf-8`,
      }).trim()
      return stagedOutput
        .split(`\n`)
        .filter((f) => f.endsWith(`CHANGELOG.md`))
    }

    return output.split(`\n`).filter((f) => f.endsWith(`CHANGELOG.md`))
  } catch {
    return []
  }
}

/**
 * Regex to match version headers:
 * - ## 1.0.0 (without date)
 * - Does NOT match ## 1.0.0 (2024-01-15) (already has date)
 */
const VERSION_HEADER_REGEX = /^(## \d+\.\d+\.\d+)(\s*)$/gm
const VERSION_WITH_DATE_REGEX = /^## \d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)/

/**
 * Add date to the first version header that doesn't have one
 */
function addDateToChangelog(filePath) {
  const content = readFileSync(filePath, `utf-8`)
  const lines = content.split(`\n`)
  const date = getFormattedDate()
  let modified = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check if this is a version header
    if (line.match(/^## \d+\.\d+\.\d+/)) {
      // Skip if it already has a date
      if (VERSION_WITH_DATE_REGEX.test(line)) {
        // First version already has date, nothing to do
        break
      }

      // Add date to this version header
      lines[i] = `${line.trim()} (${date})`
      modified = true
      console.log(`  Added date to ${filePath}: ${lines[i]}`)
      break // Only add date to the first (newest) version
    }
  }

  if (modified) {
    writeFileSync(filePath, lines.join(`\n`))
  }

  return modified
}

/**
 * Main entry point
 */
function main() {
  console.log(`Adding release dates to changelogs...`)

  const changelogs = getModifiedChangelogs()

  if (changelogs.length === 0) {
    console.log(`No modified CHANGELOG.md files found.`)
    return
  }

  console.log(`Found ${changelogs.length} modified changelog(s):`)

  let updatedCount = 0
  for (const changelog of changelogs) {
    if (addDateToChangelog(changelog)) {
      updatedCount++
    }
  }

  console.log(`Updated ${updatedCount} changelog(s) with release dates.`)
}

main()
