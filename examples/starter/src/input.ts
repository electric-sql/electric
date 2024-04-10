import { CLIUserError } from './error'
import { APP_NAME_REGEX, INVALID_APP_NAME_MESSAGE, parseAppName, parsePort, parseTemplateType, PORT_REGEX } from './parse'
import { TemplateType, validTemplates } from './templates'
import prompt from 'prompt'
import portUsed from 'tcp-port-used'

export interface CLIOptions {
  appName: string
  templateType: TemplateType
  electricPort: number
  electricProxyPort: number
}

export type DefaultCLIOptions = Omit<CLIOptions, 'appName'>


// The default options for the CLI
export const defaultOptions: DefaultCLIOptions = {
  templateType: 'react',
  electricPort: 5133,
  electricProxyPort: 65432,
} as const

function parseCLIOptions(
  args: string[],
  defaults: DefaultCLIOptions
): CLIOptions {
  // start by parsing the app name
  const appName = parseAppName(args[2])

  // initialize rest of options
  const options: CLIOptions = { appName, ...defaults }

  let restArgs = args.slice(3)
  while (restArgs.length > 0) {
    // There are arguments to parse
    const flag = restArgs[0]
    const value = restArgs[1]

    restArgs = restArgs.slice(2)

    const checkValue = () => {
      if (typeof value === 'undefined') {
        throw new CLIUserError(`Missing value for option '${flag}'.`)
      }
    }

    switch (flag) {
      case '--template':
        checkValue()
        options.templateType = parseTemplateType(value)
        break
      case '--electric-port':
        checkValue()
        options.electricPort = parsePort(value)
        break
      case '--electric-proxy-port':
        checkValue()
        options.electricProxyPort = parsePort(value)
        break
      default:
        throw new CLIUserError(`Unrecognized option: '${flag}'.`)
    }
  }

  return options
}

async function promptForCLIOptions(defaults: DefaultCLIOptions) {
  prompt.start()
  const userInput = (await prompt.get({
    properties: {
      appName: {
        description: 'App name',
        type: 'string',
        pattern: APP_NAME_REGEX,
        message: INVALID_APP_NAME_MESSAGE,
        required: true,
      },
      template: {
        description: `Template to use (${validTemplates.join(', ')})`,
        type: 'string',
        pattern: new RegExp(`^(${validTemplates.join('|')})$`),
        message: `Template should be one of: ${validTemplates.join(', ')}.`,
        default: defaults.templateType,
      },
      electricPort: {
        description: 'Port on which to run Electric',
        type: 'number',
        pattern: PORT_REGEX,
        message: 'Port should be between 0 and 65535.',
        default: defaults.electricPort,
      },
      electricProxyPort: {
        description: "Port on which to run Electric's DB proxy",
        type: 'number',
        pattern: PORT_REGEX,
        message: 'Port should be between 0 and 65535.',
        default: defaults.electricProxyPort,
      },
    },
  })) as CLIOptions

  return userInput
}


export async function getCLIOptions(args: string[], defaultOptions: DefaultCLIOptions): Promise<CLIOptions> {
  if (args.length < 3) {
    return await promptForCLIOptions(defaultOptions)
  }

  return parseCLIOptions(args, defaultOptions)
}

/**
 * Checks if the given port is open.
 * If not, it will ask the user if
 * they want to choose another port.
 * @returns The chosen port.
 */
export async function checkPort(
  oldPort: number,
  process: string,
  defaultPort: number,
  onPortOccupied?: (port: number) => void
): Promise<number> {
  const portOccupied = await portUsed.check(oldPort)
  if (!portOccupied) {
    return oldPort
  }

  onPortOccupied?.(oldPort)

  // Warn the user that the chosen port is occupied
  console.warn(`Port ${oldPort} for ${process} is already in use.`)
  // Propose user to change port
  prompt.start()

  const { port: newPort } = await prompt.get({
    properties: {
      port: {
        description: 'Hit Enter to keep it or enter a different port number',
        type: 'number',
        pattern: PORT_REGEX,
        message: 'Please choose a port between 0 and 65535',
        default: oldPort,
      },
    },
  })

  if (newPort === oldPort) {
    // user chose not to change port
    return newPort
  } else {
    // user changed port, check that it is free
    return checkPort(newPort, process, defaultPort)
  }
}