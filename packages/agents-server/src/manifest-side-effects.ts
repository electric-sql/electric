import {
  getCronStreamPathFromSpec,
  getWebhookStreamPath,
  getSharedStateStreamPath,
  resolveCronScheduleSpec,
} from '@electric-ax/agents-runtime'
import type { WakeRegistration } from './wake-registry.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

function getPgSyncManifestStreamPath(sourceRef: string): string {
  return `/_electric/pg-sync/${sourceRef}`
}

export function extractManifestSourceUrl(
  manifest: Record<string, unknown> | undefined
): string | undefined {
  if (!manifest) return undefined

  if (manifest.kind === `child` || manifest.kind === `observe`) {
    return typeof manifest.entity_url === `string`
      ? manifest.entity_url
      : undefined
  }

  if (manifest.kind === `source`) {
    const config = isRecord(manifest.config) ? manifest.config : undefined

    if (manifest.sourceType === `entity`) {
      return typeof config?.entityUrl === `string`
        ? config.entityUrl
        : typeof manifest.sourceRef === `string`
          ? manifest.sourceRef
          : undefined
    }

    if (manifest.sourceType === `cron` && config) {
      const expression = config.expression
      if (typeof expression === `string`) {
        return getCronStreamPathFromSpec(
          resolveCronScheduleSpec(
            expression,
            typeof config.timezone === `string` ? config.timezone : undefined,
            { fallback: `utc` }
          )
        )
      }
    }

    if (manifest.sourceType === `entities`) {
      return typeof manifest.sourceRef === `string`
        ? `/_entities/${manifest.sourceRef}`
        : undefined
    }

    if (manifest.sourceType === `db`) {
      return typeof manifest.sourceRef === `string`
        ? getSharedStateStreamPath(manifest.sourceRef)
        : undefined
    }

    if (manifest.sourceType === `pgSync`) {
      return typeof manifest.sourceRef === `string`
        ? getPgSyncManifestStreamPath(manifest.sourceRef)
        : undefined
    }

    if (manifest.sourceType === `webhook`) {
      if (typeof config?.streamUrl === `string`) return config.streamUrl
      if (typeof config?.endpointKey === `string`) {
        return getWebhookStreamPath(
          config.endpointKey,
          typeof config.bucket === `string` ? config.bucket : undefined
        )
      }
    }

    return undefined
  }

  if (manifest.kind === `shared-state`) {
    return typeof manifest.id === `string`
      ? getSharedStateStreamPath(manifest.id)
      : undefined
  }

  if (
    manifest.kind === `schedule` &&
    manifest.scheduleType === `cron` &&
    typeof manifest.expression === `string`
  ) {
    return getCronStreamPathFromSpec(
      resolveCronScheduleSpec(
        manifest.expression,
        typeof manifest.timezone === `string` ? manifest.timezone : undefined,
        { fallback: `utc` }
      )
    )
  }

  return undefined
}

export function extractManifestCronSpec(
  manifest: Record<string, unknown> | undefined
): { expression: string; timezone: string } | undefined {
  if (!manifest) return undefined

  if (manifest.kind === `source` && manifest.sourceType === `cron`) {
    const config = isRecord(manifest.config) ? manifest.config : undefined
    if (typeof config?.expression === `string`) {
      return resolveCronScheduleSpec(
        config.expression,
        typeof config.timezone === `string` ? config.timezone : undefined,
        { fallback: `utc` }
      )
    }
  }

  if (
    manifest.kind === `schedule` &&
    manifest.scheduleType === `cron` &&
    typeof manifest.expression === `string`
  ) {
    return resolveCronScheduleSpec(
      manifest.expression,
      typeof manifest.timezone === `string` ? manifest.timezone : undefined,
      { fallback: `utc` }
    )
  }

  return undefined
}

export function buildManifestWakeRegistration(
  subscriberUrl: string,
  manifest: Record<string, unknown> | undefined,
  manifestKey?: string
): WakeRegistration | null {
  if (!manifest) return null

  const sourceUrl = extractManifestSourceUrl(manifest)
  if (!sourceUrl) return null

  const wake =
    manifest.kind === `schedule` && manifest.scheduleType === `cron`
      ? (manifest.wake ?? { on: `change` })
      : manifest.wake

  if (wake === `runFinished`) {
    return {
      subscriberUrl,
      sourceUrl,
      condition: `runFinished`,
      oneShot: false,
      manifestKey,
    }
  }

  if (!isRecord(wake)) return null

  if (wake.on === `runFinished`) {
    return {
      subscriberUrl,
      sourceUrl,
      condition: `runFinished`,
      oneShot: false,
      includeResponse:
        typeof wake.includeResponse === `boolean`
          ? wake.includeResponse
          : undefined,
      manifestKey,
    }
  }

  if (wake.on !== `change`) return null

  const collections = Array.isArray(wake.collections)
    ? wake.collections.filter((c): c is string => typeof c === `string`)
    : undefined
  const ops = Array.isArray(wake.ops)
    ? wake.ops.filter(
        (op): op is `insert` | `update` | `delete` =>
          op === `insert` || op === `update` || op === `delete`
      )
    : undefined

  return {
    subscriberUrl,
    sourceUrl,
    condition: {
      on: `change`,
      ...(collections ? { collections } : {}),
      ...(ops ? { ops } : {}),
    },
    debounceMs:
      typeof wake.debounceMs === `number` ? wake.debounceMs : undefined,
    timeoutMs: typeof wake.timeoutMs === `number` ? wake.timeoutMs : undefined,
    oneShot: false,
    manifestKey,
  }
}
