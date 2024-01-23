#!/usr/bin/env node

import dotenvFlow from 'dotenv-flow'
dotenvFlow.config({
  silent: true,
})

import { Command } from 'commander'
import { LIB_VERSION } from '../version/index'
import { makeGenerateCommand } from './migrations/command-generate'
import { makeStartCommand } from './docker-commands/command-start'
import { makeStopCommand } from './docker-commands/command-stop'
import { makeStatusCommand } from './docker-commands/command-status'
import { makePsqlCommand } from './docker-commands/command-psql'
import { makeShowConfigCommand } from './configure/command-show-config'
import { makeWithConfigCommand } from './configure/command-with-config'
import { makeProxyTunnelCommand } from './tunnel/command-proxy-tunnel'

async function main() {
  const program = new Command()

  program
    .name('npx electric-sql')
    .description('CLI to enable building ElectricSQL projects in TypeScript')
    .version(LIB_VERSION)

  // Add commands
  ;[
    makeGenerateCommand,
    makeStartCommand,
    makeStopCommand,
    makeStatusCommand,
    makePsqlCommand,
    makeShowConfigCommand,
    makeWithConfigCommand,
    makeProxyTunnelCommand,
  ].forEach((cmd) => program.addCommand(cmd()))

  await program.parseAsync(process.argv)
}

main()
