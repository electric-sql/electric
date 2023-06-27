import { generate, defaultOptions, GeneratorOptions } from './migrate'

type GeneratorArgs = Partial<GeneratorOptions>

export async function handleGenerate(...args: string[]) {
  if (args.length > 2) {
    console.error(
      'migrate command accepts 1 optional argument (--service) but got: ' +
      args.length
    )
    process.exit(9)
  }

  // merge default options with the provided arguments
  const opts: GeneratorOptions = {
    ...defaultOptions,
    ...parseGenerateArgs(args)
  }

  await generate(opts)
}

function parseGenerateArgs(args: string[]): GeneratorArgs {
  const genArgs: GeneratorArgs = {}
  let flag: keyof GeneratorArgs | undefined = undefined
  for (const arg of args) {
    if (!flag)
      // next argument must be a flag
      flag = checkFlag(arg)
    else {
      // the value for the flag
      genArgs[flag] = arg
      flag = undefined
    }
  }

  if (flag) {
    // a flag was provided but without argument
    console.error(`Missing argument for flag --${flag} passed to generate command.`)
    process.exit(9)
  }

  // prepend protocol if not provided in service url
  if (genArgs.service && !genArgs.service.trim().startsWith('http://')) {
    genArgs.service = 'http://' + genArgs.service
  }

  return genArgs

  function checkFlag(flag: string): keyof GeneratorArgs {
    const supportedFlags = [ '--service' ]
    if (supportedFlags.includes(flag))
      return flag.substring(2) as keyof GeneratorArgs // substring removes the double dash --
    else {
      console.error(`Unsupported flag '${flag}' passed to generate command.`)
      process.exit(9)
    }
  }
}
