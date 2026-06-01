import path from 'node:path'
import fs from 'node:fs'
import pino from 'pino'

const LOG_LEVEL = process.env.ELECTRIC_AGENTS_LOG_LEVEL ?? `info`
const IS_ELECTRON_MAIN = Boolean(process.versions.electron)
const USE_FILE_LOGS = process.env.ELECTRIC_AGENTS_LOG_FILE !== `false`
const USE_PRETTY_LOGS =
  LOG_LEVEL !== `silent` && !process.env.VITEST && !IS_ELECTRON_MAIN

let _logger: pino.Logger | undefined

function getLogger(): pino.Logger {
  if (_logger) return _logger

  const streams: Array<pino.StreamEntry> = []

  try {
    if (USE_FILE_LOGS) {
      const logDir =
        process.env.ELECTRIC_AGENTS_LOG_DIR ??
        path.resolve(process.cwd(), `logs`)
      fs.mkdirSync(logDir, { recursive: true })
      const logFile = path.join(logDir, `agent-server-${Date.now()}.jsonl`)
      streams.push({
        stream: pino.destination({
          dest: logFile,
          sync: IS_ELECTRON_MAIN,
        }),
      })
    }
  } catch (err) {
    process.stderr.write(
      `[agents-server] Failed to initialize file logging: ${err instanceof Error ? err.message : err}\n`
    )
  }

  try {
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
  } catch {
    // pino-pretty unavailable — continue without pretty logging
  }

  _logger =
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
  return _logger
}

function formatArgs(args: Array<unknown>): { err?: Error; msg: string } {
  const errors: Array<Error> = []
  const parts: Array<string> = []
  for (const value of args) {
    if (value instanceof Error) errors.push(value)
    else parts.push(typeof value === `string` ? value : JSON.stringify(value))
  }
  return {
    err: errors[0],
    msg: parts.join(` `),
  }
}

export const serverLog = {
  info(...args: Array<unknown>): void {
    const { msg } = formatArgs(args)
    getLogger().info(msg)
  },

  warn(...args: Array<unknown>): void {
    const { err, msg } = formatArgs(args)
    if (err) getLogger().warn({ err }, msg)
    else getLogger().warn(msg)
  },

  error(...args: Array<unknown>): void {
    const { err, msg } = formatArgs(args)
    if (err) getLogger().error({ err }, msg)
    else getLogger().error(msg)
  },

  event(obj: Record<string, unknown>, msg: string): void {
    getLogger().info(obj, msg)
  },
}
