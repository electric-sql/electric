#!/usr/bin/env node
/**
 * Operator hygiene: list and optionally delete sprites whose name
 * starts with 'conf-sprite-' or 'e2e-sprites-'. Safety net for runaway
 * conformance / e2e leaks.
 *
 * Usage:
 *   SPRITES_TOKEN=... pnpm cleanup:sprites             # dry-run, lists matches
 *   SPRITES_TOKEN=... pnpm cleanup:sprites --delete    # actually deletes
 */
import { SpritesApiClient } from '../src/providers/fly-sprites/api-client.ts'

const PREFIXES = [`conf-sprite-`, `e2e-sprites-`]

async function main(): Promise<void> {
  const token = process.env.SPRITES_TOKEN
  if (!token) {
    console.error(`SPRITES_TOKEN env var required`)
    process.exit(1)
  }
  const client = new SpritesApiClient({ token })
  const doDelete = process.argv.includes(`--delete`)

  let total = 0
  for (const prefix of PREFIXES) {
    const r = await client.listSprites({ namePrefix: prefix })
    if (r.sprites.length === 0) continue
    console.log(`Found ${r.sprites.length} sprites matching '${prefix}':`)
    for (const s of r.sprites) {
      console.log(`  ${s.id}  ${s.name}`)
      if (doDelete) {
        try {
          await client.deleteSprite(s.name)
          console.log(`    deleted`)
        } catch (err) {
          console.error(`    delete failed:`, err)
        }
      }
    }
    total += r.sprites.length
  }
  console.log(
    `Total: ${total} ${doDelete ? `deleted` : `would-be-deleted (use --delete)`}`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
