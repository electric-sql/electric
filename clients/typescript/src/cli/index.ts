#!/usr/bin/env node

import { handleGenerate } from './migrations'

/*
 * This file is the entry point of the CLI.
 * When calling `npx electric <command> <args>`
 * this file is executed with node, passing along
 * the command and arguments provided by the user.
 *
 * Supported commands are:
 *  - `npx electric-sql generate [--out where/to/write/generated/client --service <electricHost:electricPort>]`
 *      --> Generates an Electric client based on the migrations exposed by Electric.
 *          Electric must be running in order for this command to work.
 *          The URL to the Electric migrations endpoint can be provided using the --service flag
 *          only the host and port are needed.
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
