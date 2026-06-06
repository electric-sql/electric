import { useMemo } from 'react'
import { Box, Server } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { Badge, Icon, Popover, Text } from '../ui'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import {
  getEntityRunnerId,
  resolveEffectiveSandbox,
  resolveRunner,
  runnerDisplayLabel,
} from '../lib/entityRuntime'
import { formatRelativeTime } from '../lib/formatTime'
import styles from './EntityRuntimeBadges.module.css'
import type { EffectiveSandbox } from '../lib/entityRuntime'
import type {
  ElectricEntity,
  ElectricRunner,
} from '../lib/ElectricAgentsProvider'

/**
 * Resolve the runner + sandbox an entity is associated with, from the
 * runners collection. The sandbox is always populated — when the entity has
 * no explicit profile, this reports the host "Local" default the runtime
 * falls back to (see {@link resolveEffectiveSandbox}). Runner resolution
 * degrades gracefully when the collection hasn't synced (callers fall back
 * to the id).
 */
export function useEntityRuntimeInfo(entity: ElectricEntity): {
  runnerId: string | null
  runner: ElectricRunner | null
  sandbox: EffectiveSandbox
  sandboxKey: string | null
} {
  const { runnersCollection } = useElectricAgents()
  const { data: runners = [] } = useLiveQuery(
    (q) => {
      if (!runnersCollection) return undefined
      return q.from({ r: runnersCollection })
    },
    [runnersCollection]
  )

  const runnerId = getEntityRunnerId(entity)
  const explicitProfile = entity.sandbox?.profile ?? null
  const sandboxKey = entity.sandbox?.key ?? null

  return useMemo(() => {
    const runner = resolveRunner(runners, runnerId)
    return {
      runnerId,
      runner,
      sandbox: resolveEffectiveSandbox(runners, entity, runner),
      sandboxKey,
    }
    // `explicitProfile` is the only entity-derived input to the sandbox
    // resolution; depend on it (not the whole entity) to keep this stable.
  }, [runners, runnerId, explicitProfile, sandboxKey, entity])
}

/**
 * Runner + sandbox badges for the entity header. Each badge opens a popover
 * with the corresponding runtime details. The runner badge is shown only when
 * the entity pins a runner; the sandbox badge only when a sandbox is set.
 */
export function EntityRuntimeBadges({
  entity,
}: {
  entity: ElectricEntity
}): React.ReactElement {
  const info = useEntityRuntimeInfo(entity)
  const hasRunner = info.runnerId !== null

  return (
    <span className={styles.badges}>
      {hasRunner && (
        <Popover.Root>
          <Popover.Trigger
            render={
              <button
                type="button"
                className={styles.badgeTrigger}
                aria-label="Runner"
                title="Runner"
              >
                <Badge tone="neutral" variant="soft" size={1}>
                  <Icon icon={Server} size={1} />
                  <span className={styles.badgeLabel}>
                    {runnerDisplayLabel(info.runner, info.runnerId)}
                  </span>
                </Badge>
              </button>
            }
          />
          <Popover.Content side="bottom" align="end">
            <RunnerDetails runner={info.runner} runnerId={info.runnerId} />
          </Popover.Content>
        </Popover.Root>
      )}
      <Popover.Root>
        <Popover.Trigger
          render={
            <button
              type="button"
              className={styles.badgeTrigger}
              aria-label="Sandbox"
              title="Sandbox"
            >
              <Badge
                tone={info.sandbox.remote ? `info` : `neutral`}
                variant="soft"
                size={1}
              >
                <Icon icon={Box} size={1} />
                <span className={styles.badgeLabel}>{info.sandbox.label}</span>
              </Badge>
            </button>
          }
        />
        <Popover.Content side="bottom" align="end">
          <SandboxDetails sandbox={info.sandbox} sandboxKey={info.sandboxKey} />
        </Popover.Content>
      </Popover.Root>
    </span>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}): React.ReactElement {
  return (
    <div className={styles.row}>
      <Text size={1} tone="muted" className={styles.rowLabel}>
        {label}
      </Text>
      <Text
        size={1}
        family={mono ? `mono` : undefined}
        className={styles.rowValue}
      >
        {value}
      </Text>
    </div>
  )
}

function relativeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : formatRelativeTime(ms)
}

function RunnerDetails({
  runner,
  runnerId,
}: {
  runner: ElectricRunner | null
  runnerId: string | null
}): React.ReactElement {
  const lastSeen = relativeFromIso(runner?.last_seen_at)
  return (
    <div className={styles.popoverBody}>
      <div className={styles.popoverTitle}>
        <Icon icon={Server} size={2} />
        <Text size={2}>{runnerDisplayLabel(runner, runnerId)}</Text>
      </div>
      <div className={styles.rows}>
        {runner ? (
          <>
            <DetailRow label="Kind" value={runner.kind} />
            <DetailRow label="Status" value={runner.admin_status} />
            {lastSeen && <DetailRow label="Last seen" value={lastSeen} />}
            <DetailRow label="ID" value={runner.id} mono />
          </>
        ) : (
          <>
            {runnerId && <DetailRow label="ID" value={runnerId} mono />}
            <Text size={1} tone="muted">
              Runner is not currently registered.
            </Text>
          </>
        )}
      </div>
    </div>
  )
}

function SandboxDetails({
  sandbox,
  sandboxKey,
}: {
  sandbox: EffectiveSandbox
  sandboxKey: string | null
}): React.ReactElement {
  return (
    <div className={styles.popoverBody}>
      <div className={styles.popoverTitle}>
        <Icon icon={Box} size={2} />
        <Text size={2}>{sandbox.label}</Text>
      </div>
      <div className={styles.rows}>
        <DetailRow label="Profile" value={sandbox.name} mono />
        {sandbox.description && (
          <Text size={1} tone="muted">
            {sandbox.description}
          </Text>
        )}
        <DetailRow
          label="Location"
          value={sandbox.remote ? `Remote` : `Host`}
        />
        {sandbox.isDefault && (
          <Text size={1} tone="muted">
            No profile was chosen at spawn — running the host default.
          </Text>
        )}
        {sandboxKey && <DetailRow label="Workspace" value={sandboxKey} mono />}
      </div>
    </div>
  )
}
