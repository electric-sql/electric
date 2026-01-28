import * as fs from 'node:fs'
import * as path from 'node:path'
import { SKILLS, type SkillName } from '../index.js'
import { getSkillsDir } from './list-skills.js'

/**
 * Reads and outputs the full content of a skill.
 */
export function readSkill(skillName: string): string | null {
  if (!SKILLS.includes(skillName as SkillName)) {
    console.error(`Error: Unknown skill "${skillName}"`)
    console.error(`Available skills: ${SKILLS.join(`, `)}`)
    return null
  }

  const skillsDir = getSkillsDir()
  const skillPath = path.join(skillsDir, skillName, `SKILL.md`)

  if (!fs.existsSync(skillPath)) {
    console.error(`Error: Skill file not found at ${skillPath}`)
    return null
  }

  return fs.readFileSync(skillPath, `utf-8`)
}

/**
 * Prints the skill content to stdout.
 */
export function printSkill(skillName: string): void {
  const content = readSkill(skillName)
  if (content) {
    console.log(content)
  } else {
    process.exit(1)
  }
}
