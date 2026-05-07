import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, SplitSquareHorizontal } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { inArray } from '@tanstack/db'
import { useWorkspace } from '../hooks/useWorkspace'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { Icon, IconButton, Text, Tooltip } from '../ui'
import { StatusDot } from './StatusDot'
import { JsonInspectDialog } from './JsonInspectDialog'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import styles from './EntityContextDrawer.module.css'
import type {
  EntityStreamDBWithActions,
  Manifest,
} from '@electric-ax/agents-runtime'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

type DrawerEntity = Pick<
  ElectricEntity,
  `url` | `type` | `status` | `tags` | `spawn_args`
>

type DrawerEntry =
  | {
      key: string
      groupKey: string
      groupLabel: string
      title: string
      meta: string
      manifest: Manifest
      action:
        | { kind: `entity`; url: string }
        | { kind: `state`; sourceId: string }
        | { kind: `inspect` }
      entity: DrawerEntity | null
    }
  | {
      key: string
      groupKey: `parent`
      groupLabel: `Parent`
      title: string
      meta: string
      manifest: null
      action: { kind: `entity`; url: string }
      entity: DrawerEntity
    }

type ManifestDrawerEntry = Extract<DrawerEntry, { manifest: Manifest }>

type DrawerGroup = {
  key: string
  label: string
  entries: Array<DrawerEntry>
}

type InspectTarget = {
  title: string
  value: unknown
}

/**
 * Drawer that docks ABOVE the chat composer at the bottom of an entity
 * session, surfacing context about related entities (and, in time,
 * pending messages, tool-call alerts, etc.).
 *
 * The composer in `<MessageInput>` is z-indexed over the drawer so the
 * drawer's bottom edge tucks behind it — visually the composer reads
 * as a tray pulled forward over the drawer card. The drawer's
 * `padding-bottom` reserves the overlap area so its content never
 * disappears under the composer. Horizontal `margin-inline` insets
 * the drawer inside the composer's border radius so it visually reads
 * as nested *inside* the composer.
 *
 * Sections are independent and self-determine whether to render. The
 * drawer returns `null` when no section has anything to say so the
 * composer's existing -20px lift into the timeline above it is
 * preserved unchanged for sessions without related entities.
 */
export function EntityContextDrawer({
  entity,
  db,
  tileId,
}: {
  entity: ElectricEntity
  db: EntityStreamDBWithActions | null
  tileId: string
}): React.ReactElement | null {
  const { entitiesCollection } = useElectricAgents()
  const { helpers } = useWorkspace()
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null)

  const parentUrl = entity.parent

  const { data: manifests = [] } = useLiveQuery(
    (q) => {
      if (!db) return undefined
      return q
        .from({ manifest: db.collections.manifests })
        .orderBy(({ manifest }) => manifest._seq, `asc`)
    },
    [db]
  )

  const referencedEntityUrls = useMemo(() => {
    const urls = new Set<string>()
    if (parentUrl) urls.add(parentUrl)
    for (const manifest of manifests as Array<Manifest>) {
      if (manifest.kind === `child`) {
        urls.add(manifest.entity_url)
      } else if (
        manifest.kind === `source` &&
        manifest.sourceType === `entity`
      ) {
        urls.add(manifest.sourceRef)
      }
    }
    return Array.from(urls)
  }, [manifests, parentUrl])

  const { data: referencedEntities = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || referencedEntityUrls.length === 0) {
        return undefined
      }
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => inArray(e.url, referencedEntityUrls))
        .select(({ e }) => ({
          url: e.url,
          type: e.type,
          status: e.status,
          tags: e.tags,
          spawn_args: e.spawn_args,
        }))
    },
    [entitiesCollection, referencedEntityUrls]
  )

  const entitiesByUrl = useMemo(() => {
    return new Map(referencedEntities.map((e) => [e.url, e]))
  }, [referencedEntities])

  const parent = parentUrl ? (entitiesByUrl.get(parentUrl) ?? null) : null
  const groups = useMemo(
    () => buildDrawerGroups(parent, manifests, entitiesByUrl),
    [parent, manifests, entitiesByUrl]
  )

  if (groups.length === 0) return null

  const openEntity = (url: string, side = false): void => {
    helpers.openEntity(url, {
      ...(side ? { target: { tileId, position: `split-right` as const } } : {}),
    })
  }

  const openStateInspector = (sourceId: string, side = false): void => {
    helpers.openEntity(entity.url, {
      viewId: `state-explorer`,
      viewParams: { source: sourceId },
      ...(side ? { target: { tileId, position: `split-right` as const } } : {}),
    })
  }

  const handleEntry = (entry: DrawerEntry): void => {
    if (entry.action.kind === `entity`) {
      openEntity(entry.action.url)
    } else if (entry.action.kind === `state`) {
      openStateInspector(entry.action.sourceId)
    } else {
      setInspectTarget({ title: entry.title, value: entry.manifest })
    }
  }

  const handleSide = (entry: DrawerEntry): void => {
    if (entry.action.kind === `entity`) {
      openEntity(entry.action.url, true)
    } else if (entry.action.kind === `state`) {
      openStateInspector(entry.action.sourceId, true)
    }
  }

  return (
    <>
      <div className={styles.drawer}>
        {groups.map((group) => (
          <ManifestSection
            key={group.key}
            group={group}
            onSelect={handleEntry}
            onOpenSide={handleSide}
          />
        ))}
      </div>
      <JsonInspectDialog
        open={inspectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setInspectTarget(null)
        }}
        title={inspectTarget?.title ?? `Manifest entry`}
        value={inspectTarget?.value ?? null}
      />
    </>
  )
}

function buildDrawerGroups(
  parent: DrawerEntity | null,
  manifests: ReadonlyArray<Manifest>,
  entitiesByUrl: Map<string, DrawerEntity>
): Array<DrawerGroup> {
  const grouped = new Map<string, DrawerGroup>()

  if (parent) {
    grouped.set(`parent`, {
      key: `parent`,
      label: `Parent`,
      entries: [createParentEntry(parent)],
    })
  }

  for (const manifest of manifests) {
    const rawEntry = createManifestEntry(manifest, entitiesByUrl)
    if (!rawEntry) continue
    const entry: DrawerEntry =
      rawEntry.manifest.kind !== `child`
        ? {
            ...rawEntry,
            groupKey: `manifest`,
            groupLabel: `Manifest items`,
            title: `${manifestKindLabel(rawEntry.manifest)} · ${rawEntry.title}`,
          }
        : rawEntry

    const group = grouped.get(entry.groupKey)
    if (group) {
      group.entries.push(entry)
    } else {
      grouped.set(entry.groupKey, {
        key: entry.groupKey,
        label: entry.groupLabel,
        entries: [entry],
      })
    }
  }

  const groups = Array.from(grouped.values()).filter(
    (group) => group.entries.length > 0
  )
  const manifestGroupIndex = groups.findIndex(
    (group) => group.key === `manifest`
  )
  if (manifestGroupIndex >= 0) {
    const [manifestGroup] = groups.splice(manifestGroupIndex, 1)
    groups.push(manifestGroup!)
  }

  return groups
}

function manifestKindLabel(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return `Child`
    case `source`:
      return `${titleCase(manifest.sourceType)} source`
    case `shared-state`:
      return `Shared state`
    case `effect`:
      return `Effect`
    case `context`:
      return `Context`
    case `schedule`:
      return manifest.scheduleType === `cron` ? `Cron schedule` : `Future send`
  }
}

function createParentEntry(parent: DrawerEntity): DrawerEntry {
  const { title, isFromSlug } = getEntityDisplayTitle(parent)
  const id = parent.url.split(`/`).pop() ?? parent.url
  return {
    key: `parent:${parent.url}`,
    groupKey: `parent`,
    groupLabel: `Parent`,
    title,
    meta: isFromSlug ? parent.type : `${parent.type} · ${id}`,
    manifest: null,
    action: { kind: `entity`, url: parent.url },
    entity: parent,
  }
}

function createManifestEntry(
  manifest: Manifest,
  entitiesByUrl: Map<string, DrawerEntity>
): ManifestDrawerEntry | null {
  switch (manifest.kind) {
    case `child`: {
      const url = manifest.entity_url
      const entity = entitiesByUrl.get(url) ?? null
      return {
        key: manifest.key,
        groupKey: `child`,
        groupLabel: `Children`,
        title: manifest.id,
        meta: `${manifest.entity_type}${manifest.observed ? `` : ` · unobserved`}`,
        manifest,
        action: { kind: `entity`, url },
        entity,
      }
    }

    case `source`: {
      if (manifest.sourceType === `entity`) {
        const entity = entitiesByUrl.get(manifest.sourceRef) ?? null
        return {
          key: manifest.key,
          groupKey: `source:entity`,
          groupLabel: `Entity Sources`,
          title: manifest.sourceRef.split(`/`).pop() ?? manifest.sourceRef,
          meta: manifest.sourceRef,
          manifest,
          action: { kind: `entity`, url: manifest.sourceRef },
          entity,
        }
      }

      if (manifest.sourceType === `db`) {
        return {
          key: manifest.key,
          groupKey: `source:db`,
          groupLabel: `Database Sources`,
          title: manifest.sourceRef,
          meta: describeSourceConfig(manifest.config),
          manifest,
          action: { kind: `state`, sourceId: manifest.sourceRef },
          entity: null,
        }
      }

      return {
        key: manifest.key,
        groupKey: `source:${manifest.sourceType}`,
        groupLabel: `${titleCase(manifest.sourceType)} Sources`,
        title: manifest.sourceRef,
        meta: describeSourceConfig(manifest.config),
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }
    }

    case `shared-state`:
      return {
        key: manifest.key,
        groupKey: `shared-state`,
        groupLabel: `Shared State`,
        title: manifest.id,
        meta: `${manifest.mode} · ${Object.keys(manifest.collections).join(`, `)}`,
        manifest,
        action: { kind: `state`, sourceId: manifest.id },
        entity: null,
      }

    case `effect`:
      return {
        key: manifest.key,
        groupKey: `effect`,
        groupLabel: `Effects`,
        title: manifest.id,
        meta: manifest.function_ref,
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }

    case `context`:
      return {
        key: manifest.key,
        groupKey: `context`,
        groupLabel: `Context`,
        title: manifest.name,
        meta: manifest.id,
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }

    case `schedule`:
      return {
        key: manifest.key,
        groupKey: `schedule:${manifest.scheduleType}`,
        groupLabel:
          manifest.scheduleType === `cron` ? `Cron Schedules` : `Future Sends`,
        title: manifest.id,
        meta: describeSchedule(manifest),
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }
  }
}

function describeSourceConfig(config: unknown): string {
  if (!isRecord(config)) return `source`
  const collections = getCollections(config.collections)
  if (collections.length > 0) return collections.join(`, `)
  return `source`
}

function describeSchedule(manifest: Manifest): string {
  if (manifest.kind !== `schedule`) return `schedule`
  if (manifest.scheduleType === `cron`) {
    return manifest.timezone
      ? `${manifest.expression} · ${manifest.timezone}`
      : manifest.expression
  }
  return manifest.status
    ? `${manifest.fireAt} · ${manifest.status}`
    : manifest.fireAt
}

function getCollections(value: unknown): Array<string> {
  if (!isRecord(value)) return []
  return Object.keys(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(` `)
}

function ManifestSection({
  group,
  onSelect,
  onOpenSide,
}: {
  group: DrawerGroup
  onSelect: (entry: DrawerEntry) => void
  onOpenSide: (entry: DrawerEntry) => void
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight
  const canOpenSide = group.entries.some(
    (entry) => entry.action.kind !== `inspect`
  )

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.row}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className={styles.iconSlot}>
          <Icon icon={Chevron} size={2} className={styles.chevron} />
        </span>
        <Text size={2} className={styles.headerLabel}>
          {group.entries.length} {group.label}
        </Text>
      </button>
      {expanded &&
        group.entries.map((entry) => (
          <ManifestRow
            key={entry.key}
            entry={entry}
            canOpenSide={canOpenSide && entry.action.kind !== `inspect`}
            onSelect={onSelect}
            onOpenSide={onOpenSide}
          />
        ))}
    </div>
  )
}

function ManifestRow({
  entry,
  canOpenSide,
  onSelect,
  onOpenSide,
}: {
  entry: DrawerEntry
  canOpenSide: boolean
  onSelect: (entry: DrawerEntry) => void
  onOpenSide: (entry: DrawerEntry) => void
}): React.ReactElement {
  return (
    <div className={styles.rowShell}>
      <button
        type="button"
        className={styles.row}
        onClick={() => onSelect(entry)}
        title={entry.meta}
      >
        <span className={styles.iconSlot}>
          {entry.entity ? <StatusDot status={entry.entity.status} /> : null}
        </span>
        <span className={styles.rowMain}>
          <Text size={2} className={styles.rowTitle}>
            {entry.title}
          </Text>
          <Text size={1} tone="muted" className={styles.rowMeta}>
            {entry.meta}
          </Text>
        </span>
      </button>
      {canOpenSide && (
        <Tooltip content="Open to side">
          <IconButton
            type="button"
            size={1}
            variant="ghost"
            tone="neutral"
            className={styles.sideButton}
            aria-label={`Open ${entry.title} to side`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenSide(entry)
            }}
          >
            <Icon icon={SplitSquareHorizontal} size={1} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  )
}
