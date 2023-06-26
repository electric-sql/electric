#!/usr/bin/env node

import { migrate } from './migrations'

const args = process.argv

if (args.length < 3) {
  throw new Error(
    'Too few arguments passed to CLI bin. Expected at least a command but got none.'
  )
}

// When this file is called as follows: `node bin.js migrate`
// the arguments will be the path to node, the path to bin.js, "migrate",
// followed by the rest of the arguments
const [_node, _file, command, ...commandArgs] = process.argv

const commandHandlers = {
  migrate: handleMigrate,
}

if (!Object.prototype.hasOwnProperty.call(commandHandlers, command)) {
  throw new Error('Unknown command: ' + command)
}

const handler = commandHandlers[command as keyof typeof commandHandlers]
handler(...commandArgs)

function handleMigrate(...args: string[]) {
  if (args.length > 1) {
    throw new Error(
      'migrate command accepts 1 optional argument (the path to the Prisma schema) but got: ' +
        args.length
    )
  }

  const pathToPrismaSchema = args[0] ?? 'prisma/schema.prisma'
  migrate(pathToPrismaSchema)
}
