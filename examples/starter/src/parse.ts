import { CLIUserError } from './error'
import { TemplateType, validTemplates } from './templates'

// Regex to check that a number is between 0 and 65535
export const PORT_REGEX =
  /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/

// Validate the project name to follow
// the restrictions for Docker compose project names.
// cf. https://docs.docker.com/compose/environment-variables/envvars/
// Because we will use the app name as the Docker compose project name.
export const APP_NAME_REGEX = /^[a-z0-9]+[a-z0-9-_]*$/

export const INVALID_APP_NAME_MESSAGE =
  `Invalid app name. ` +
  'App names must contain only lowercase letters, decimal digits, dashes, and underscores, ' +
  'and must begin with a lowercase letter or decimal digit.'

export function parseAppName(appName: string): string {
  if (!APP_NAME_REGEX.test(appName)) {
    throw new CLIUserError(INVALID_APP_NAME_MESSAGE)
  }
  return appName
}

export function parsePort(port: string): number {
  if (!PORT_REGEX.test(port)) {
    throw new CLIUserError(
      `Invalid port '${port}. Port should be between 0 and 65535.'`,
    )
  }
  return Number.parseInt(port)
}

export function parseTemplateType(templateType: string): TemplateType {
  if (!(validTemplates as unknown as string[]).includes(templateType)) {
    throw new CLIUserError(
      `Invalid template type '${templateType}'. ` +
        `Must be one of: ${validTemplates.join(', ')}`,
    )
  }
  return templateType as TemplateType
}
