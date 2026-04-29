import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const TEMPLATE_REPO = `electric-sql/electric/tree/main/examples/agents-chat-starter`

export async function initProject(projectName?: string): Promise<void> {
  const name = projectName ?? `my-agents-app`
  const targetDir = path.resolve(process.cwd(), name)

  if (fs.existsSync(targetDir)) {
    console.error(`Error: directory "${name}" already exists`)
    process.exit(1)
  }

  console.log(`Scaffolding Electric Agents project into ${name}...`)
  console.log(``)

  try {
    execSync(`npx gitpick ${TEMPLATE_REPO} ${name}`, {
      stdio: `inherit`,
      cwd: process.cwd(),
    })
  } catch {
    console.error(`Failed to scaffold project. Make sure npx is available.`)
    process.exit(1)
  }

  console.log(``)
  console.log(`Done! Next steps:`)
  console.log(``)
  console.log(`  cd ${name}`)
  console.log(`  pnpm install`)
  console.log(`  cp .env.example .env`)
  console.log(``)
  console.log(`Then set your ANTHROPIC_API_KEY in .env`)
  console.log(`Get one at https://console.anthropic.com/settings/keys`)
  console.log(``)
  console.log(`Start infrastructure and run:`)
  console.log(`  npx electric-ax agent quickstart  # in one terminal`)
  console.log(`  pnpm dev                          # in another terminal`)
  console.log(``)
}
