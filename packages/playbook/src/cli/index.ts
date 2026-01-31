import { runInstall } from './install.js'
import { printSkillList } from './list.js'
import { printSkill } from './show.js'

const HELP = `
@electric-sql/playbook - Electric Playbook for building apps with Electric

Usage:
  npx @electric-sql/playbook <command> [options]

Commands:
  install              Install thin skill pointers to agent directories
  list                 List all available skills
  show <name>          Output the full content of a skill

Install Options:
  --global, -g         Install to global directories (~/.claude/skills, etc.)
  --force, -f          Overwrite existing skill files
  --target, -t <path>  Target directory (defaults to current directory)

Environment Variables:
  ELECTRIC_PLAYBOOK_SKILLS_DIR   Override skills source directory (for local development)

Examples:
  npx @electric-sql/playbook install
  npx @electric-sql/playbook install --global
  npx @electric-sql/playbook install --target ~/projects/my-app
  npx @electric-sql/playbook list
  npx @electric-sql/playbook show electric

Local Development:
  ELECTRIC_PLAYBOOK_SKILLS_DIR=./packages/playbook/skills node dist/cli/index.js install

For more information, see: https://electric-sql.com
`

function main(): void {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case `install`:
      runInstall(args.slice(1))
      break

    case `list`:
      printSkillList()
      break

    case `show`: {
      const skillName = args[1]
      if (!skillName) {
        console.error(`Error: Please specify a skill name.`)
        console.error(`Usage: npx @electric-sql/playbook show <name>`)
        console.error(
          `Run "npx @electric-sql/playbook list" to see available skills.`
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
