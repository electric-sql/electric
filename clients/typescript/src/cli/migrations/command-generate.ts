import { Command, InvalidArgumentError } from 'commander'
import { dedent } from '../utils'
import {
  generate,
  type GeneratorOptions,
  defaultPollingInterval,
} from './migrate'
import { addOptionGroupToCommand, getConfig } from '../config'

export { generate }

interface GenerateCommandArgs {
  watch?: number | true
  withMigrations?: string
  debug?: boolean
}

export function makeGenerateCommand(): Command {
  const command = new Command('generate')
  command.description('Generate ElectricSQL client')

  addOptionGroupToCommand(command, 'client')

  command
    .option(
      '-w, --watch [pollingInterval]',
      dedent`
        Optional flag to specify that the migrations should be watched.

        When new migrations are found, the client is rebuilt automatically.

        You can provide an optional polling interval in milliseconds,
        which is how often we should poll Electric for new migrations.
      `,
      (pollingInterval: string) => {
        const parsed = parseInt(pollingInterval)
        if (isNaN(parsed)) {
          throw new InvalidArgumentError(
            `Invalid polling interval: ${pollingInterval}. Should be a time in milliseconds (i.e. a positive integer).`
          )
        }
        return parsed
      }
    )

    .option(
      '--with-migrations <migrationsCommand>',
      dedent`
        Optional flag to specify a command to run to generate migrations.

        With this option the work flow is:
        1. Start new ElectricSQL and PostgreSQL containers
        2. Run the provided migrations command
        3. Generate the client
        4. Stop and remove the containers
      `
    )

    .option(
      '--debug',
      dedent`
        Optional flag to enable debug mode.
      `
    )

    .action(async (opts: GenerateCommandArgs) => {
      const { watch, withMigrations, debug, ...restOpts } = opts
      const config = getConfig(restOpts)

      const genOpts: GeneratorOptions = {
        config,
        withMigrations,
        debug,
      }
      if (watch !== undefined) {
        genOpts.watch = true
        genOpts.pollingInterval =
          watch === true ? defaultPollingInterval : watch
      }

      await generate(genOpts)
    })

  return command
}
