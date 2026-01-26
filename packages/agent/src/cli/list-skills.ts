import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKILLS } from '../index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface SkillInfo {
  name: string
  description: string
  path: string
}

/**
 * Gets the path to the skills directory.
 * Set ELECTRIC_AGENT_SKILLS_DIR env var to override (for local development).
 */
export function getSkillsDir(): string {
  if (process.env.ELECTRIC_AGENT_SKILLS_DIR) {
    return process.env.ELECTRIC_AGENT_SKILLS_DIR
  }
  // When running from dist/, skills/ is at package root
  return path.resolve(__dirname, `../../skills`)
}

/**
 * Parses YAML frontmatter from a skill file.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  const result: Record<string, string> = {}

  for (const line of yaml.split(`\n`)) {
    const colonIndex = line.indexOf(`:`)
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      const value = line
        .slice(colonIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, ``)
      result[key] = value
    }
  }

  return result
}

/**
 * Lists all available skills with their descriptions.
 */
export function listSkills(): SkillInfo[] {
  const skillsDir = getSkillsDir()
  const skills: SkillInfo[] = []

  for (const skillName of SKILLS) {
    const skillPath = path.join(skillsDir, skillName, `SKILL.md`)

    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, `utf-8`)
      const frontmatter = parseFrontmatter(content)

      skills.push({
        name: skillName,
        description: frontmatter.description || `No description`,
        path: skillPath,
      })
    } else {
      skills.push({
        name: skillName,
        description: `(skill file not found)`,
        path: skillPath,
      })
    }
  }

  return skills
}

/**
 * Prints the skill list to stdout.
 */
export function printSkillList(): void {
  const skills = listSkills()

  console.log(`\nAvailable Electric Agent Skills:\n`)

  const maxNameLen = Math.max(...skills.map((s) => s.name.length))

  for (const skill of skills) {
    const padding = ` `.repeat(maxNameLen - skill.name.length + 2)
    console.log(`  ${skill.name}${padding}${skill.description}`)
  }

  console.log(
    `\nUse "npx @electric-sql/agent read-skill <name>" to view full content.`
  )
  console.log(``)
}
