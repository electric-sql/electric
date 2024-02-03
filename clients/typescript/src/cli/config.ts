import type { Command } from 'commander'
import { extractDatabaseURL, extractServiceURL } from './utils'
import { configOptions } from './config-options'

export type ConfigMap = Record<string, string | number | boolean>

export interface AnyConfigOption {
  doc: string
  valueType: typeof String | typeof Number | typeof Boolean
  valueTypeName?: string
  shortForm?: string
  inferVal?: (options: ConfigMap) => string | number | boolean | undefined
  defaultVal?:
    | string
    | number
    | boolean
    | ((options: ConfigMap) => string | number | boolean)
  constructedDefault?: string
  groups?: Readonly<string[]>
}

export type ConfigOptions = typeof configOptions

export type ConfigOptionName = keyof ConfigOptions

type ConfigOption<T extends ConfigOptionName> = ConfigOptions[T]

type ConfigOptionValue<T extends ConfigOptionName> = ConfigOption<T> extends {
  inferVal: undefined
  defaultVal: undefined
}
  ? ReturnType<ConfigOption<T>['valueType']> | undefined
  : ReturnType<ConfigOption<T>['valueType']>

export function inferDbUrlPart<
  K extends keyof ReturnType<typeof extractDatabaseURL>
>(
  part: K,
  options: any = {},
  defaultValue?: ReturnType<typeof extractDatabaseURL>[K]
): ReturnType<typeof extractDatabaseURL>[K] | undefined {
  const url =
    options.databaseUrl ||
    options.DATABASE_URL ||
    process.env.ELECTRIC_DATABASE_URL
  if (url) {
    return extractDatabaseURL(url)?.[part] ?? defaultValue
  }
  return defaultValue
}

export function inferProxyUrlPart<
  K extends keyof ReturnType<typeof extractDatabaseURL>
>(
  part: K,
  options: any = {},
  defaultValue?: ReturnType<typeof extractDatabaseURL>[K]
): ReturnType<typeof extractDatabaseURL>[K] | undefined {
  const url = options.proxy || options.PROXY || process.env.ELECTRIC_PROXY
  if (url) {
    return extractDatabaseURL(url)?.[part] ?? defaultValue
  }
  return defaultValue
}

export function inferServiceUrlPart<
  K extends keyof ReturnType<typeof extractServiceURL>
>(
  part: K,
  options: any = {},
  defaultValue?: ReturnType<typeof extractServiceURL>[K]
): ReturnType<typeof extractServiceURL>[K] | undefined {
  const url = options.service || options.SERVICE || process.env.ELECTRIC_SERVICE
  if (url) {
    return extractServiceURL(url)?.[part] ?? defaultValue
  }
  return defaultValue
}

export function getConfigValue<K extends ConfigOptionName>(
  name: K,
  options?: any
): ConfigOptionValue<K> {
  // First check if the option was passed as a command line argument
  if (options) {
    const optName = snakeToCamel(name.toLocaleLowerCase())
    if (options[optName] !== undefined) {
      return options[optName] as ConfigOptionValue<K>
    } else if (options[name] !== undefined) {
      return options[name] as ConfigOptionValue<K>
    }
  }

  // Then check if the option has an method to infer a value from other options.
  // If we get a value from this method, use it.
  const inferVal = (configOptions[name] as AnyConfigOption).inferVal as (
    options: ConfigMap
  ) => ConfigOptionValue<K> | undefined
  if (inferVal) {
    const val = inferVal(options)
    if (val !== undefined) {
      return val
    }
  }

  // Then check if the option was passed as an environment variable
  const envName = name.startsWith('ELECTRIC_') ? name : `ELECTRIC_${name}`
  const envVal = process.env[envName]
  if (configOptions[name].valueType === Boolean) {
    return (!!envVal &&
      !['f', 'false', '0', '', 'no'].includes(
        envVal?.toLocaleLowerCase()
      )) as ConfigOptionValue<K>
  }
  if (envVal !== undefined) {
    if (configOptions[name].valueType === Number) {
      return parseInt(envVal) as ConfigOptionValue<K>
    } else {
      return envVal as ConfigOptionValue<K>
    }
  }

  // Finally, check if the option has a default value
  const defaultVal = (configOptions[name] as AnyConfigOption).defaultVal as
    | ConfigOptionValue<K>
    | ((options: ConfigMap) => ConfigOptionValue<K>)
  if (typeof defaultVal === 'function') {
    return defaultVal(options)
  }
  return defaultVal
}

export type Config = {
  [K in ConfigOptionName]: ConfigOptionValue<K>
}

type ConfigCamelCase = {
  [K in ConfigOptionName as `${Camelize<Lowercase<K>>}`]: ConfigOptionValue<K>
}

type GetConfigOptions = Partial<Config & ConfigCamelCase>

export type Group = ConfigOptions[ConfigOptionName]['groups'][number]

export type ConfigForGroup<G extends Group> = {
  [K in ConfigOptionName as G extends ConfigOptions[K]['groups'][number]
    ? K
    : never]: ConfigOptionValue<K>
}

export type GetConfigOptionsForGroup<G extends Group> = Partial<
  ConfigForGroup<G> & {
    [K in ConfigOptionName as G extends ConfigOptions[K]['groups'][number]
      ? `${Camelize<Lowercase<K>>}`
      : never]: ConfigOptionValue<K>
  }
>

/**
 * Get the current configuration for Electric from environment variables and
 * any passed options.
 * @param options Object containing options to override the environment variables
 * @returns The current configuration
 */
export function getConfig(options?: GetConfigOptions): Config {
  return Object.fromEntries(
    Object.keys(configOptions).map((name) => [
      name,
      getConfigValue(name as ConfigOptionName, options ?? {}),
    ])
  ) as Config
}

export function envFromConfig(config: Config) {
  return Object.fromEntries(
    Object.keys(config).map((name) => [
      name.startsWith('ELECTRIC_') ? name : `ELECTRIC_${name}`,
      config[name as ConfigOptionName]?.toString(),
    ])
  )
}

function snakeToCamel(s: string) {
  return s
    .toLocaleLowerCase()
    .replace(/(_+\w)/g, (m) => m.slice(-1).toUpperCase())
}

export function addOptionToCommand(
  command: Command,
  optionName: ConfigOptionName
) {
  let argName = optionName.toLocaleLowerCase().replace(/_/g, '-')
  if (argName.startsWith('electric-')) {
    argName = argName.slice('electric-'.length)
  }
  let localName: string = optionName
  if (!optionName.startsWith('ELECTRIC_')) {
    localName = `ELECTRIC_${optionName}`
  }
  const opt = configOptions[optionName] as AnyConfigOption
  let flags
  if (opt.shortForm) {
    flags = `-${opt.shortForm}, --${argName}`
  } else {
    flags = `--${argName}`
  }
  if (opt.valueType !== Boolean) {
    if (opt.valueTypeName !== undefined) {
      flags += ` <${opt.valueTypeName}>`
    } else if (opt.valueType === Number) {
      flags += ` <number>`
    } else if (opt.valueType === String) {
      flags += ` <string>`
    } else {
      throw new Error(`Unknown value type: ${opt.valueType}`)
    }
  }
  let doc = `${opt.doc}\nEnv var: ${localName}`
  if (opt.constructedDefault) {
    doc += `\nDefault: ${opt.constructedDefault}`
  } else if (typeof opt.defaultVal !== 'function') {
    doc += `\nDefault: ${opt.defaultVal}`
  }
  command.option(flags, doc)
}

export function addOptionGroupToCommand(command: Command, groupName: string) {
  Object.entries(configOptions).forEach(([name, opt]) => {
    const groups: Readonly<string[]> = opt.groups ?? []
    if (groups.includes(groupName)) {
      addOptionToCommand(command, name as ConfigOptionName)
    }
  })
}

type Camelize<T extends string> = T extends `${infer A}_${infer B}`
  ? `${A}${Camelize<Capitalize<B>>}`
  : T
