import { main } from './cli.js'

main().catch((error) => {
  console.error(`Unexpected error:`, error)
  process.exit(1)
})
