import path from 'node:path'
import fs from 'node:fs'
import pino from 'pino'

const LOG_LEVEL = process.env.ELECTRIC_AGENTS_LOG_LEVEL ?? `info`
const USE_FILE_LOGS = process.env.ELECTRIC_AGENTS_LOG_FILE !== `false`
const USE_PRETTY_LOGS = LOG_LEVEL !== `silent` && !process.env.VITEST

const LOG_DIR = USE_FILE_LOGS
  ? (process.env.ELECTRIC_AGENTS_LOG_DIR ?? path.resolve(process.cwd(), `logs`))
  : undefined
const LOG_FILE = LOG_DIR
  ? path.join(LOG_DIR, `agent-server-${Date.now()}.jsonl`)
  : undefined

if (LOG_DIR) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

export const LOG_FILE_PATH = LOG_FILE

const streams: Array<pino.StreamEntry> = []
if (LOG_FILE) {
  streams.push({ stream: pino.destination(LOG_FILE) })
}
if (USE_PRETTY_LOGS) {
  streams.push({
    stream: pino.transport({
      target: `pino-pretty`,
      options: {
        colorize: true,
        ignore: `pid,hostname,name`,
        translateTime: `SYS:HH:MM:ss`,
      },
    }),
  })
}

const logger =
  streams.length > 0
    ? pino(
        {
          base: undefined,
          level: LOG_LEVEL,
        },
        pino.multistream(streams)
      )
    : pino({
        base: undefined,
        enabled: false,
        level: LOG_LEVEL,
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

export const serverLog = {
  info(...args: Array<unknown>): void {
    const { msg } = formatArgs(args)
    logger.info(msg)
  },

  warn(...args: Array<unknown>): void {
    const { err, msg } = formatArgs(args)
    if (err) logger.warn({ err }, msg)
    else logger.warn(msg)
  },

  error(...args: Array<unknown>): void {
    const { err, msg } = formatArgs(args)
    if (err) logger.error({ err }, msg)
    else logger.error(msg)
  },

  event(obj: Record<string, unknown>, msg: string): void {
    logger.info(obj, msg)
  },
}
