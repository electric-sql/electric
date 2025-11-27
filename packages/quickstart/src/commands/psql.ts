import { execSync } from 'child_process'

export function psqlCommand(): void {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error(`DATABASE_URL environment variable not found`)
    console.error(`Ensure .env file exists with DATABASE_URL`)
    process.exit(1)
  }

  console.log(`Connecting to database...`)
  console.log(`Type \\q to exit`)
  console.log(``)

  try {
    execSync(`psql "${databaseUrl}"`, {
      stdio: `inherit`,
      env: { ...process.env },
    })
  } catch (error) {
    console.error(
      `Failed to connect:`,
      error instanceof Error ? error.message : error
    )
    console.error(``)
    console.error(`Common issues:`)
    console.error(`- psql not found (install PostgreSQL client)`)
    console.error(`- Invalid database URL (check .env)`)
    console.error(`- Network connectivity`)
    process.exit(1)
  }
}
