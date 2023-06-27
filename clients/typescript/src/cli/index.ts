#!/usr/bin/env node

import { migrate } from './migrations'
import path from 'path'

const args = process.argv

if (args.length < 3) {
  console.error(
    'Too few arguments passed to CLI bin. Expected at least one command but got none.'
  )
  process.exit(9)
}

// When this file is called as follows: `node index.js migrate`
// the arguments will be the path to node, the path to index.js, "migrate",
// followed by the rest of the arguments
const [_node, _file, command, ...commandArgs] = process.argv

const commandHandlers = {
  migrate: handleMigrate,
}

if (!Object.prototype.hasOwnProperty.call(commandHandlers, command)) {
  console.error('Unknown command: ' + command)
  process.exit(9)
}

const handler = commandHandlers[command as keyof typeof commandHandlers]
await handler(...commandArgs)

async function handleMigrate(...args: string[]) {
  if (args.length > 1) {
    console.error(
      'migrate command accepts 1 optional argument (the path to the Prisma schema) but got: ' +
        args.length
    )
    process.exit(9)
  }

  const pathToPrismaSchema = args[0] ?? path.join('prisma/schema.prisma')
  await migrate(pathToPrismaSchema)
}
