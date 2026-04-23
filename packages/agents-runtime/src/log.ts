import pino from 'pino'

function readNodeEnv(): Record<string, string | undefined> {
  const maybeProcess = Reflect.get(globalThis as object, `process`) as unknown
  if (typeof maybeProcess !== `object` || maybeProcess === null) {
    return {}
  }

  const versions = Reflect.get(maybeProcess, `versions`) as unknown
  if (typeof versions !== `object` || versions === null) {
    return {}
  }
  if (typeof Reflect.get(versions, `node`) !== `string`) {
    return {}
  }

  const env = Reflect.get(maybeProcess, `env`) as unknown
  return typeof env === `object` && env !== null
    ? (env as Record<string, string | undefined>)
    : {}
}

const _env = readNodeEnv()
const LOG_LEVEL = _env.ELECTRIC_AGENTS_LOG_LEVEL ?? `info`

function readStdoutIsTTY(): boolean {
  const maybeProcess = Reflect.get(globalThis as object, `process`) as unknown
  if (typeof maybeProcess !== `object` || maybeProcess === null) {
    return false
  }

  const stdout = Reflect.get(maybeProcess, `stdout`) as unknown
  if (typeof stdout !== `object` || stdout === null) {
    return false
  }

  return Reflect.get(stdout, `isTTY`) === true
}

function readBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if ([`1`, `true`, `yes`, `on`].includes(normalized)) {
    return true
  }
  if ([`0`, `false`, `no`, `off`].includes(normalized)) {
    return false
  }

  return undefined
}

const USE_PRETTY_LOGS =
  LOG_LEVEL !== `silent` &&
  !_env.VITEST &&
  (readBooleanEnv(_env.ELECTRIC_AGENTS_PRETTY_LOGS) ?? readStdoutIsTTY())

const logger = pino({
  base: undefined,
  level: LOG_LEVEL,
  ...(USE_PRETTY_LOGS
    ? {
        transport: {
          target: `pino-pretty`,
          options: {
            colorize: true,
            ignore: `pid,hostname,name`,
            translateTime: `SYS:HH:MM:ss`,
          },
        },
      }
    : {}),
})

function formatArgs(args: Array<unknown>): { err?: Error; msg: string } {
  const errors: Array<Error> = []
  const parts: Array<string> = []
  for (const a of args) {
    if (a instanceof Error) errors.push(a)
    else parts.push(typeof a === `string` ? a : JSON.stringify(a))
  }
  return {
    err: errors[0],
    msg: parts.join(` `),
  }
}

export const runtimeLog = {
  debug(prefix: string, message: string, ...args: Array<unknown>): void {
    const { msg } = formatArgs(args)
    logger.debug(`${prefix} ${message}${msg ? ` ` + msg : ``}`)
  },
  info(prefix: string, message: string, ...args: Array<unknown>): void {
    const { msg } = formatArgs(args)
    logger.info(`${prefix} ${message}${msg ? ` ` + msg : ``}`)
  },
  warn(prefix: string, message: string, ...args: Array<unknown>): void {
    const { err, msg } = formatArgs(args)
    const fullMsg = `${prefix} ${message}${msg ? ` ` + msg : ``}`
    if (err) logger.warn({ err }, fullMsg)
    else logger.warn(fullMsg)
  },
  error(prefix: string, message: string, ...args: Array<unknown>): void {
    const { err, msg } = formatArgs(args)
    const fullMsg = `${prefix} ${message}${msg ? ` ` + msg : ``}`
    if (err) logger.error({ err }, fullMsg)
    else logger.error(fullMsg)
  },
}

export function createEntityLogPrefix(label: string): string {
  return `[${label}]`
}
