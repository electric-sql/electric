#!/usr/bin/env node

import { migrate } from './migrations'
import { initialise } from './init'
import path from 'path'

/*
 * This file is the entry point of the CLI.
 * When calling `npx electric <command> <args>`
 * this file is executed with node, passing along
 * the command and arguments provided by the user.
 *
 * Supported commands are:
 *  - `npx electric init <appId> [--force]`
 *      --> Initialises your app with the necessary config files.
 *          Will throw an error if some config files already exist.
 *          Use the --force flag to override existing config files.
 *  - `npx electric migrate [-p path/to/prisma/schema]`
 *      --> Fetches all migrations from Electric and upgrades the client.
 *          Electric must be running in order for this command to work.
 */

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

type CommandHandlers = {
  init: (...args: string[]) => Promise<void>
  migrate: (...args: string[]) => Promise<void>
}
const commandHandlers: CommandHandlers = {
  init: handleInit,
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

async function handleInit(...args: string[]) {
  const appId = args[0]
  if (args.length === 0 || appId === '--force') {
    console.error("Please provide an app identifier to the 'init' command")
    process.exit(9)
  }
  if (args.length > 2) {
    console.error(
      `init command accepts 2 arguments: the app identifier and an optional --force flag, but got ${args.length} arguments`
    )
    process.exit(9)
  }

  const force = args[1] === '--force'
  // no need to await, NodeJS waits until the promise has been fulfilled before exiting the program
  await initialise(appId, force)
}
