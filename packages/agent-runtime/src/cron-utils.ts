import { CronExpressionParser } from 'cron-parser'

export interface CronScheduleSpec {
  expression: string
  timezone: string
}

export const CRON_STREAM_PREFIX = `/_cron/`

type TimezoneFallback = `local` | `utc`

function canonicalizeTimezone(timezone: string): string {
  return new Intl.DateTimeFormat(`en-US`, {
    timeZone: timezone,
  }).resolvedOptions().timeZone
}

export function getDefaultCronTimezone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (typeof detected === `string` && detected.length > 0) {
    try {
      return canonicalizeTimezone(detected)
    } catch {
      // Fall through to UTC when the host exposes an invalid timezone.
    }
  }
  return `UTC`
}

export function resolveCronTimezone(
  timezone?: string,
  opts?: { fallback?: TimezoneFallback }
): string {
  const fallback = opts?.fallback ?? `utc`
  const raw =
    timezone ?? (fallback === `utc` ? `UTC` : getDefaultCronTimezone())
  try {
    return canonicalizeTimezone(raw)
  } catch {
    throw new Error(`Invalid cron timezone: "${raw}"`)
  }
}

export function resolveCronScheduleSpec(
  expression: string,
  timezone?: string,
  opts?: { fallback?: TimezoneFallback }
): CronScheduleSpec {
  const resolvedTimezone = resolveCronTimezone(timezone, opts)
  try {
    CronExpressionParser.parse(expression, { tz: resolvedTimezone })
  } catch {
    throw new Error(`Invalid cron expression: "${expression}"`)
  }
  return {
    expression,
    timezone: resolvedTimezone,
  }
}

function encodeCronScheduleSpec(spec: CronScheduleSpec): string {
  return Buffer.from(JSON.stringify(spec)).toString(`base64url`)
}

export function getCronStreamPathFromSpec(spec: CronScheduleSpec): string {
  return `${CRON_STREAM_PREFIX}${encodeCronScheduleSpec(spec)}`
}

export function getCronStreamPath(
  expression: string,
  timezone?: string,
  opts?: { fallback?: TimezoneFallback }
): string {
  return getCronStreamPathFromSpec(
    resolveCronScheduleSpec(expression, timezone, opts)
  )
}

export function getCronSourceRef(
  expression: string,
  timezone?: string,
  opts?: { fallback?: TimezoneFallback }
): string {
  return encodeCronScheduleSpec(
    resolveCronScheduleSpec(expression, timezone, opts)
  )
}

export function decodeCronScheduleSpec(
  encoded: string,
  opts?: { fallback?: TimezoneFallback }
): CronScheduleSpec {
  const decoded = Buffer.from(encoded, `base64url`).toString()
  try {
    const parsed = JSON.parse(decoded) as {
      expression?: unknown
      timezone?: unknown
    }
    if (typeof parsed.expression === `string`) {
      return resolveCronScheduleSpec(
        parsed.expression,
        typeof parsed.timezone === `string` ? parsed.timezone : undefined,
        opts
      )
    }
  } catch {
    // Legacy cron identifiers encoded only the expression.
  }

  return resolveCronScheduleSpec(decoded, undefined, {
    fallback: opts?.fallback ?? `utc`,
  })
}

export function parseCronStreamPath(
  streamPath: string,
  opts?: { fallback?: TimezoneFallback }
): CronScheduleSpec {
  if (!streamPath.startsWith(CRON_STREAM_PREFIX)) {
    throw new Error(`Invalid cron stream path: ${streamPath}`)
  }

  const encoded = streamPath.slice(CRON_STREAM_PREFIX.length)
  if (!encoded) {
    throw new Error(`Invalid cron stream path: ${streamPath}`)
  }

  return decodeCronScheduleSpec(encoded, opts)
}

export function getNextCronFireAt(
  expression: string,
  timezone: string,
  currentDate?: Date
): Date {
  return CronExpressionParser.parse(expression, {
    tz: resolveCronTimezone(timezone, { fallback: `utc` }),
    ...(currentDate ? { currentDate } : {}),
  })
    .next()
    .toDate()
}
