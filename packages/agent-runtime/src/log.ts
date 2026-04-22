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
const USE_PRETTY_LOGS =
  !!_env.ELECTRIC_AGENTS_LOG_LEVEL && LOG_LEVEL !== `silent` && !_env.VITEST

const logger = pino({
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
