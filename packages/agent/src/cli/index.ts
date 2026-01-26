import { runInstall } from './install.js'
import { printSkillList } from './list-skills.js'
import { printSkill } from './read-skill.js'

const HELP = `
@electric-sql/agent - Agent skills for building apps with Electric

Usage:
  npx @electric-sql/agent <command> [options]

Commands:
  install              Install thin skill pointers to agent directories
  list-skills          List all available skills
  read-skill <name>    Output the full content of a skill

Install Options:
  --global, -g         Install to global directories (~/.claude/skills, etc.)
  --force, -f          Overwrite existing skill files
  --target, -t <path>  Target directory (defaults to current directory)

Environment Variables:
  ELECTRIC_AGENT_SKILLS_DIR   Override skills source directory (for local development)

Examples:
  npx @electric-sql/agent install
  npx @electric-sql/agent install --global
  npx @electric-sql/agent install --target ~/projects/my-app
  npx @electric-sql/agent list-skills
  npx @electric-sql/agent read-skill electric

Local Development:
  ELECTRIC_AGENT_SKILLS_DIR=./packages/agent/skills node dist/cli/index.js install

For more information, see: https://electric-sql.com
`

function main(): void {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case `install`:
      runInstall(args.slice(1))
      break

    case `list-skills`:
      printSkillList()
      break

    case `read-skill`: {
      const skillName = args[1]
      if (!skillName) {
        console.error(`Error: Please specify a skill name.`)
        console.error(`Usage: npx @electric-sql/agent read-skill <name>`)
        console.error(
          `Run "npx @electric-sql/agent list-skills" to see available skills.`
        )
        process.exit(1)
      }
      printSkill(skillName)
      break
    }

    case `help`:
    case `--help`:
    case `-h`:
    case undefined:
      console.log(HELP)
      break

    default:
      console.error(`Unknown command: ${command}`)
      console.log(HELP)
      process.exit(1)
  }
}

main()
