import * as fs from 'node:fs'
import * as path from 'node:path'
import { detectAgents, getBasePath, ensureDir } from './detect-agents.js'

// Only install the router skill - it guides agents to load others as needed
const ROUTER_SKILL = `electric`

// Rich description for agent activation on relevant queries
const ROUTER_DESCRIPTION = `Electric - Postgres sync engine for local-first apps. Use for: ElectricSQL, shapes, real-time sync, TanStack DB, offline-first, optimistic mutations, Postgres replication, durable streams. Load full skill content with command below.`

/**
 * Generates the thin skill content that points to the full skill.
 * If ELECTRIC_PLAYBOOK_SKILLS_DIR is set, uses cat for local testing.
 */
function generateThinSkill(skillName: string): string {
  const localSkillsDir = process.env.ELECTRIC_PLAYBOOK_SKILLS_DIR
  const command = localSkillsDir
    ? `cat ${localSkillsDir}/${skillName}/SKILL.md`
    : `npx @electric-sql/playbook show ${skillName}`

  return `---
name: ${skillName}
description: "${ROUTER_DESCRIPTION}"
globs:
triggers:
  - electric
  - electricsql
  - shapes
  - local-first
  - offline-first
  - postgres sync
  - real-time sync
  - tanstack db
  - optimistic mutations
  - durable streams
---

# Electric Playbook

Load the full skill content to get comprehensive guidance on building local-first apps with Electric.

**Run this command:**

\`\`\`bash
${command}
\`\`\`
`
}

export interface InstallOptions {
  global?: boolean
  force?: boolean
  target?: string // Target directory (defaults to cwd)
}

export interface InstallResult {
  installed: string[]
  skipped: string[]
  errors: string[]
}

/**
 * Installs thin skill pointers to detected agent directories.
 */
export function installSkills(options: InstallOptions = {}): InstallResult {
  const basePath = options.target || getBasePath(options.global ?? false)
  const agents = detectAgents(basePath)

  const result: InstallResult = {
    installed: [],
    skipped: [],
    errors: [],
  }

  if (agents.length === 0) {
    console.log(`No agent directories detected.`)
    console.log(`Looked for: .claude/, .cursor/, .codex/, .github/, .windsurf/`)
    console.log(`In: ${basePath}`)
    console.log(
      `\nCreate one of these directories first, or use --global to install to ~/.claude/skills etc.`
    )
    return result
  }

  console.log(
    `\nInstalling Electric skills to ${options.global ? `global` : `project`} agent directories...\n`
  )

  for (const agent of agents) {
    console.log(`${agent.name}:`)

    // Ensure skills directory exists
    ensureDir(agent.skillsDir)

    // Only install the router skill - it guides agents to load others
    const skillDir = path.join(agent.skillsDir, ROUTER_SKILL)
    const skillFile = path.join(skillDir, `SKILL.md`)

    try {
      if (fs.existsSync(skillFile) && !options.force) {
        result.skipped.push(`${agent.name}/${ROUTER_SKILL}`)
        console.log(
          `  - ${ROUTER_SKILL}: skipped (already exists, use --force to overwrite)`
        )
      } else {
        ensureDir(skillDir)
        fs.writeFileSync(skillFile, generateThinSkill(ROUTER_SKILL))
        result.installed.push(`${agent.name}/${ROUTER_SKILL}`)
        console.log(`  - ${ROUTER_SKILL}: installed`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`${agent.name}/${ROUTER_SKILL}: ${message}`)
      console.log(`  - ${ROUTER_SKILL}: error - ${message}`)
    }

    console.log(``)
  }

  // Summary
  if (result.installed.length > 0) {
    console.log(`Installed ${result.installed.length} skill(s).`)
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} existing skill(s).`)
  }
  if (result.errors.length > 0) {
    console.log(`Encountered ${result.errors.length} error(s).`)
  }

  return result
}

/**
 * Runs the install command.
 */
export function runInstall(args: string[]): void {
  // Parse --target <path>
  let target: string | undefined
  const targetIdx = args.findIndex((a) => a === `--target` || a === `-t`)
  if (targetIdx !== -1 && args[targetIdx + 1]) {
    target = args[targetIdx + 1]
  }

  const options: InstallOptions = {
    global: args.includes(`--global`) || args.includes(`-g`),
    force: args.includes(`--force`) || args.includes(`-f`),
    target,
  }

  installSkills(options)
}
