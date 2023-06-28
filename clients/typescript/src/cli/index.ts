#!/usr/bin/env node

import { handleGenerate } from './migrations'

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

const commandHandlers = {
  generate: handleGenerate,
}

if (!Object.prototype.hasOwnProperty.call(commandHandlers, command)) {
  console.error('Unknown command: ' + command)
  process.exit(9)
}

const handler = commandHandlers[command as keyof typeof commandHandlers]
await handler(...commandArgs)
