import { claimResources } from '../electric-api'

export async function claimCommand(): Promise<void> {
  const sourceId = process.env.ELECTRIC_SOURCE_ID
  const secret = process.env.ELECTRIC_SECRET

  if (!sourceId || !secret) {
    console.error(
      `Missing ELECTRIC_SOURCE_ID or ELECTRIC_SECRET environment variables`
    )
    console.error(`Ensure .env file exists with Electric credentials`)
    process.exit(1)
  }

  console.log(`Initiating resource claim...`)

  try {
    const result = await claimResources(sourceId, secret)

    console.log(`Resource claim initiated`)
    console.log(``)
    console.log(`Open URL to complete claim:`)
    console.log(result.claimUrl)
    console.log(``)
    console.log(`This will:`)
    console.log(`- Link Electric Cloud account`)
    console.log(`- Link Neon database account`)
    console.log(`- Transfer temporary resources`)
    console.log(``)
    console.log(
      `Warning: Temporary resources expire if not claimed within days`
    )
  } catch (error) {
    console.error(
      `Failed to initiate resource claim:`,
      error instanceof Error ? error.message : error
    )
    console.error(``)
    console.error(`Common issues:`)
    console.error(`- Invalid credentials (check .env file)`)
    console.error(`- Resources already claimed`)
    console.error(`- Network connectivity`)
    process.exit(1)
  }
}
