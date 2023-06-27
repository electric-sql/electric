#!/usr/bin/env node

import { handleGenerate } from './migrations'

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
