import pino from 'pino'

export const log = pino({
  name: `coding-agents`,
  level: process.env.LOG_LEVEL ?? `info`,
  ...(process.env.NODE_ENV !== `production`
    ? {
        transport: {
          target: `pino-pretty`,
          options: { colorize: true, translateTime: `HH:MM:ss.l` },
        },
      }
    : {}),
})
