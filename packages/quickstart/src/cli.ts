#!/usr/bin/env node

import { provisionElectricResources } from './electric-api.js'
import { setupTemplate } from './template-setup.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error(`Usage: quickstart <app-name>`)

    process.exit(1)
  }

  const appName = args[0]

  // Validate app name
  if (!/^[a-zA-Z0-9-_]+$/.test(appName)) {
    console.error(
      `App name must contain only letters, numbers, hyphens, and underscores`
    )

    process.exit(1)
  }

  console.log(`Creating app: ${appName}`)

  try {
    console.log(`Provisioning resources...`)
    const credentials = await provisionElectricResources()

    // Step 2: Setup TanStack Start template
    console.log(`Setting up template...`)
    await setupTemplate(appName, credentials)

    // Step 3: Display completion message
    console.log(`Setup complete`)
    console.log(``)
    console.log(`Next steps:`)
    console.log(`  cd ${appName}`)
    console.log(`  pnpm dev`)
    console.log(``)
    console.log(`Commands:`)
    console.log(`  pnpm psql     # Connect to database`)
    console.log(`  pnpm claim    # Claim resources`)
    console.log(`  pnpm deploy   # Deploy to Netlify`)
    console.log(``)
    console.log(`Tutorial: https://electric-sql.com/docs`)
  } catch (error) {
    console.error(
      `Setup failed:`,
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Unexpected error:`, error)
    process.exit(1)
  })
}

export { main }
