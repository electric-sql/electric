import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { AGENT_SKILL_DIRS, type AgentDir } from '../index.js'

export interface DetectedAgent {
  name: string
  skillsDir: string
  exists: boolean
}

/**
 * Detects agent skill directories in the given base path.
 * Checks for .claude/skills, .cursor/skills, etc.
 */
export function detectAgents(basePath: string): DetectedAgent[] {
  const agents: DetectedAgent[] = []

  for (const dir of AGENT_SKILL_DIRS) {
    const skillsDir = path.join(basePath, dir)
    const parentDir = path.dirname(skillsDir)
    const parentExists = fs.existsSync(parentDir)

    // Extract agent name from directory (e.g., ".claude/skills" -> "Claude")
    const agentName = getAgentName(dir)

    agents.push({
      name: agentName,
      skillsDir,
      exists: parentExists,
    })
  }

  return agents.filter((a) => a.exists)
}

/**
 * Gets a human-readable agent name from the directory path.
 */
function getAgentName(dir: AgentDir): string {
  const nameMap: Record<AgentDir, string> = {
    '.claude/skills': `Claude Code`,
    '.cursor/skills': `Cursor`,
    '.codex/skills': `OpenAI Codex`,
    '.github/skills': `GitHub Copilot`,
    '.windsurf/skills': `Windsurf`,
  }
  return nameMap[dir]
}

/**
 * Gets the appropriate base path for skill installation.
 * Uses HOME for --global, cwd otherwise.
 */
export function getBasePath(isGlobal: boolean): string {
  return isGlobal ? os.homedir() : process.cwd()
}

/**
 * Ensures a directory exists, creating it if necessary.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
