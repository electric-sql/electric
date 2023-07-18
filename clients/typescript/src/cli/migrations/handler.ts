import * as z from 'zod'
import { generate, defaultOptions, GeneratorOptions } from './migrate'

type GeneratorArgs = Partial<GeneratorOptions>

/**
 * Handles calls to `npx electric-sql generate`.
 * The generate command supports the following arguments:
 *  - `--service <url>`
 *     Optional argument providing the url to connect to Electric.
 *     If not provided, it uses the url set in the `ELECTRIC_URL`
 *     environment variable. If that variable is not set, it
 *     resorts to the default url which is `http://localhost:5050`.
 *  - `--out <path>`
 *     Optional argument to specify where to write the generated client.
 *     If this argument is not provided the generated client is written
 *     to `./src/generated/client`.
 *  - `--watch [<pollingInterval>]`
 *     Optional flag to specify that the migrations should be watched.
 *     When new migrations are found, the client is rebuilt automatically.
 *     You can provide an optional polling interval in milliseconds,
 *     which is how often we should poll Electric for new migrations.
 * @param args Arguments passed to the generate command.
 */
export async function handleGenerate(...args: string[]) {
  // merge default options with the provided arguments
  const opts: GeneratorOptions = {
    ...defaultOptions,
    ...parseGenerateArgs(args),
  }

  await generate(opts)
}

export function parseGenerateArgs(args: string[]): GeneratorArgs {
  const genArgs: GeneratorArgs = {}
  let flag: keyof GeneratorArgs | undefined = undefined
  for (const arg of args) {
    if (!flag)
      // next argument must be a flag
      flag = checkFlag(arg)
    else {
      // the value for the flag
      if (flag === 'watch') {
        // the --watch flag is special because
        // it accepts an optional argument
        // which is the polling interval in ms
        genArgs[flag] = true
        try {
          genArgs.pollingInterval = z
            .number()
            .int()
            .positive()
            .parse(parseInt(arg))
        } catch (_e) {
          console.error(
            `The provided argument to --watch is not a valid polling interval. Should be a time in milliseconds (i.e. a positive integer).`
          )
          process.exit(9)
        }
      } else {
        genArgs[
          flag as keyof Omit<GeneratorArgs, 'watch' | 'pollingInterval'>
        ] = arg
      }
      flag = undefined
    }
  }

  if (flag) {
    if (flag === 'watch') {
      genArgs[flag] = true
    } else {
      // a flag that expects an argument was provided but the argument is missing
      console.error(
        `Missing argument for flag --${flag} passed to generate command.`
      )
      process.exit(9)
    }
  }
  const service = genArgs.service?.trim()
  
  // prepend protocol if not provided in service url
  if (service && !/^https?:\/\//.test(service)) {
    genArgs.service = 'http://' + service
  }

  return genArgs
}

function checkFlag(flag: string): keyof GeneratorArgs {
  const supportedFlags = ['--service', '--out', '--watch']
  if (supportedFlags.includes(flag))
    return flag.substring(2) as keyof GeneratorArgs
  // substring removes the double dash --
  else {
    console.error(`Unsupported flag '${flag}' passed to generate command.`)
    process.exit(9)
  }
}
