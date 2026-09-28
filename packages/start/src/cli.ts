#!/usr/bin/env node

import { execSync } from 'child_process'
import { setupTemplate } from './template-setup.js'
import { join } from 'path'

const USAGE = `Usage: npx @electric-sql/start <app-name>`
const USAGE_CURRENT_DIR = `       npx @electric-sql/start .  (configure current directory)`

interface ParsedArgs {
  appName: string
}

function parseArgs(args: string[]): ParsedArgs {
  const positionalArgs: string[] = []

  for (const arg of args) {
    if (arg.startsWith(`-`)) {
      console.error(`Error: Unknown option: ${arg}`)
      console.error(USAGE)
      process.exit(1)
    }
    positionalArgs.push(arg)
  }

  if (positionalArgs.length === 0) {
    console.error(USAGE)
    console.error(USAGE_CURRENT_DIR)
    process.exit(1)
  }

  if (positionalArgs.length > 1) {
    console.error(
      `Error: Expected only one app name, but received multiple: ${positionalArgs.join(`, `)}`
    )
    console.error(USAGE)
    process.exit(1)
  }

  return { appName: positionalArgs[0] }
}

interface NextStepsOptions {
  showInstall?: boolean
}

function printNextSteps(appName: string, options: NextStepsOptions = {}) {
  const { showInstall = false } = options

  console.log(``)
  console.log(`Next steps:`)
  if (appName !== `.`) {
    console.log(`  cd ${appName}`)
  }

  if (showInstall) {
    console.log(`  pnpm install`)
  }

  console.log(`  pnpm backend:up       # Start Postgres and Electric in Docker`)
  console.log(`  pnpm migrate          # Apply database migrations`)
  console.log(`  pnpm dev              # Start the dev server`)
  console.log(``)
  console.log(`Then open https://localhost:5173`)
  console.log(``)
  console.log(
    `Requires Docker (for Postgres and Electric) and Caddy (for HTTPS`
  )
  console.log(`in development). See the app's README.md for details.`)
  console.log(``)
  console.log(`Commands:`)
  console.log(`  pnpm psql             # Connect to database`)
  console.log(`  pnpm backend:down     # Stop Postgres and Electric`)
  console.log(`  pnpm backend:clear    # Stop them and delete their data`)
  console.log(``)
  console.log(`Tutorial: https://electric-sql.com/docs`)
}

async function main() {
  const args = process.argv.slice(2)
  const { appName } = parseArgs(args)

  // Validate app name (skip validation for "." which means current directory)
  if (appName !== `.` && !/^[a-zA-Z0-9-_]+$/.test(appName)) {
    console.error(
      `App name must contain only letters, numbers, hyphens, and underscores`
    )

    process.exit(1)
  }

  if (appName === `.`) {
    console.log(`Configuring current directory...`)
  } else {
    console.log(`Creating app: ${appName}`)
  }

  try {
    console.log(`Setting up template...`)
    await setupTemplate(appName)

    console.log(`Installing dependencies...`)
    try {
      execSync(`pnpm install`, {
        stdio: `inherit`,
        cwd: appName === `.` ? process.cwd() : join(process.cwd(), appName),
      })
    } catch (_error) {
      console.log(`Failed to install dependencies`)
      printNextSteps(appName, { showInstall: true })
      process.exit(1)
    }

    console.log(`Setup complete`)
    printNextSteps(appName)
  } catch (error) {
    console.error(
      `Setup failed:`,
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

export { main }
