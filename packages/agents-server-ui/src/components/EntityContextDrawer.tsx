import { useMemo, useState } from 'react'
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  Pencil,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react'
import { inArray, useLiveQuery } from '@tanstack/react-db'
import { useWorkspace } from '../hooks/useWorkspace'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { Icon, IconButton, Text, Tooltip } from '../ui'
import { StatusDot } from './StatusDot'
import { JsonInspectDialog } from './JsonInspectDialog'
import {
  AttachmentImagePreviewDialog,
  type AttachmentImagePreviewItem,
} from './AttachmentImagePreviewDialog'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { createQueuePositionBetween, readTextPayload } from '../lib/sendMessage'
import {
  attachmentDisplayName,
  attachmentDownloadUrl,
  isAttachmentManifest,
} from '../lib/attachments'
import styles from './EntityContextDrawer.module.css'
import type {
  EntityStreamDBWithActions,
  EntityTimelineData,
  Manifest,
} from '@electric-ax/agents-runtime/client'
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

function stableEntityUrlKey(urls: Iterable<string>): string {
  return Array.from(new Set(urls)).sort().join(`\0`)
}

function entityUrlsFromKey(key: string): Array<string> {
  return key.length === 0 ? [] : key.split(`\0`)
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
  baseUrl,
  tileId,
  pendingMessages = [],
  pendingEditingKey = null,
  pendingActionsDisabled = false,
  onEditPending,
  onDeletePending,
  onSteerPending,
  onReorderPending,
}: {
  entity: ElectricEntity
  db: EntityStreamDBWithActions | null
  baseUrl: string
  tileId: string
  pendingMessages?: EntityTimelineData[`inbox`]
  pendingEditingKey?: string | null
  pendingActionsDisabled?: boolean
  onEditPending?: (message: EntityTimelineData[`inbox`][number]) => void
  onDeletePending?: (key: string) => void
  onSteerPending?: (key: string) => void
  onReorderPending?: (key: string, position: string) => void
}): React.ReactElement | null {
  const { entitiesCollection } = useElectricAgents()
  const { helpers } = useWorkspace()
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null)
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentImagePreviewItem | null>(null)

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

  const referencedEntityUrlKey = useMemo(() => {
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
    return stableEntityUrlKey(urls)
  }, [manifests, parentUrl])
  const referencedEntityUrls = useMemo(
    () => entityUrlsFromKey(referencedEntityUrlKey),
    [referencedEntityUrlKey]
  )

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
    [entitiesCollection, referencedEntityUrlKey]
  )

  const entitiesByUrl = useMemo(() => {
    return new Map(referencedEntities.map((e) => [e.url, e]))
  }, [referencedEntities])

  const parent = parentUrl ? (entitiesByUrl.get(parentUrl) ?? null) : null
  const groups = useMemo(
    () => buildDrawerGroups(parent, manifests, entitiesByUrl),
    [parent, manifests, entitiesByUrl]
  )

  const hasPendingSection =
    pendingMessages.length > 0 &&
    onEditPending !== undefined &&
    onDeletePending !== undefined &&
    onSteerPending !== undefined &&
    onReorderPending !== undefined

  if (groups.length === 0 && !hasPendingSection) return null

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
        {hasPendingSection && (
          <PendingInboxSection
            messages={pendingMessages}
            editingKey={pendingEditingKey}
            onEdit={onEditPending}
            onDelete={onDeletePending}
            onSteer={onSteerPending}
            onReorder={onReorderPending}
            disabled={pendingActionsDisabled}
          />
        )}
        {groups.map((group) => (
          <ManifestSection
            key={group.key}
            group={group}
            baseUrl={baseUrl}
            entityUrl={entity.url}
            onSelect={handleEntry}
            onOpenSide={handleSide}
            onPreviewAttachment={setPreviewAttachment}
          />
        ))}
      </div>
      {previewAttachment && (
        <AttachmentImagePreviewDialog
          attachment={previewAttachment}
          open={previewAttachment !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewAttachment(null)
          }}
        />
      )}
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

function PendingInboxSection({
  messages,
  editingKey,
  onEdit,
  onDelete,
  onSteer,
  onReorder,
  disabled,
}: {
  messages: EntityTimelineData[`inbox`]
  editingKey: string | null
  onEdit: (message: EntityTimelineData[`inbox`][number]) => void
  onDelete: (key: string) => void
  onSteer: (key: string) => void
  onReorder: (key: string, position: string) => void
  disabled: boolean
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    key: string
    placement: `before` | `after`
  } | null>(null)
  const Chevron = expanded ? ChevronDown : ChevronRight

  const clearDragState = (): void => {
    setDraggingKey(null)
    setDropTarget(null)
  }

  const getDropPlacement = (
    event: React.DragEvent<HTMLElement>
  ): `before` | `after` => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? `before` : `after`
  }

  const reorderMessage = (
    draggedKey: string,
    targetKey: string,
    placement: `before` | `after`
  ): void => {
    if (disabled) return
    const fromIndex = messages.findIndex(
      (message) => message.key === draggedKey
    )
    const targetIndex = messages.findIndex(
      (message) => message.key === targetKey
    )
    if (fromIndex < 0 || targetIndex < 0 || draggedKey === targetKey) {
      return
    }

    const nextOrder = [...messages]
    const [moved] = nextOrder.splice(fromIndex, 1)
    if (!moved) return
    const targetIndexAfterRemoval = nextOrder.findIndex(
      (message) => message.key === targetKey
    )
    if (targetIndexAfterRemoval < 0) return
    const insertIndex =
      placement === `before`
        ? targetIndexAfterRemoval
        : targetIndexAfterRemoval + 1
    nextOrder.splice(insertIndex, 0, moved)

    const movedIndex = nextOrder.findIndex(
      (message) => message.key === draggedKey
    )
    const previous = movedIndex > 0 ? nextOrder[movedIndex - 1] : undefined
    const next =
      movedIndex >= 0 && movedIndex < nextOrder.length - 1
        ? nextOrder[movedIndex + 1]
        : undefined
    const position = createQueuePositionBetween(
      previous?.position,
      next?.position
    )
    onReorder(draggedKey, position)
  }

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
          {messages.length} Queued
        </Text>
      </button>
      {expanded &&
        messages.map((message) => (
          <div
            key={message.key}
            className={[
              styles.rowShell,
              draggingKey === message.key ? styles.pendingDragging : null,
              dropTarget?.key === message.key &&
              dropTarget.placement === `before`
                ? styles.pendingDropBefore
                : null,
              dropTarget?.key === message.key &&
              dropTarget.placement === `after`
                ? styles.pendingDropAfter
                : null,
            ]
              .filter(Boolean)
              .join(` `)}
            draggable={!disabled}
            onDragStart={(event) => {
              if (disabled) return
              setDraggingKey(message.key)
              event.dataTransfer.effectAllowed = `move`
              event.dataTransfer.setData(`text/plain`, message.key)
            }}
            onDragOver={(event) => {
              if (disabled) return
              if (!draggingKey || draggingKey === message.key) return
              event.preventDefault()
              event.dataTransfer.dropEffect = `move`
              setDropTarget({
                key: message.key,
                placement: getDropPlacement(event),
              })
            }}
            onDragLeave={() => {
              setDropTarget((current) =>
                current?.key === message.key ? null : current
              )
            }}
            onDrop={(event) => {
              if (disabled) return
              event.preventDefault()
              const draggedKey =
                event.dataTransfer.getData(`text/plain`) || draggingKey
              const placement = getDropPlacement(event)
              clearDragState()
              if (draggedKey) {
                reorderMessage(draggedKey, message.key, placement)
              }
            }}
            onDragEnd={clearDragState}
          >
            <div
              className={[
                styles.row,
                styles.pendingTextRow,
                editingKey === message.key ? styles.pendingRowEditing : null,
              ]
                .filter(Boolean)
                .join(` `)}
              title={readTextPayload(message.payload)}
            >
              <span className={styles.iconSlot}>
                <Icon
                  icon={GripVertical}
                  size={1}
                  className={styles.dragHandle}
                />
              </span>
              <span className={styles.rowMain}>
                <Text size={2} className={styles.rowTitle}>
                  {readTextPayload(message.payload) || `Untitled message`}
                </Text>
              </span>
            </div>
            <span className={styles.pendingActions}>
              <IconButton
                type="button"
                size={1}
                variant="ghost"
                tone="neutral"
                className={styles.pendingActionButton}
                aria-label="Edit queued message"
                disabled={disabled}
                onClick={() => onEdit(message)}
              >
                <Icon icon={Pencil} size={1} />
              </IconButton>
              <IconButton
                type="button"
                size={1}
                variant="ghost"
                tone="neutral"
                className={styles.pendingActionButton}
                aria-label="Steer now"
                disabled={disabled}
                onClick={() => onSteer(message.key)}
              >
                <Icon icon={ArrowUp} size={1} />
              </IconButton>
              <IconButton
                type="button"
                size={1}
                variant="ghost"
                tone="neutral"
                className={styles.pendingActionButton}
                aria-label="Delete queued message"
                disabled={disabled}
                onClick={() => onDelete(message.key)}
              >
                <Icon icon={Trash2} size={1} />
              </IconButton>
            </span>
          </div>
        ))}
    </div>
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
    case `attachment`:
      return `Attachment`
    case `context`:
      return `Context`
    case `schedule`:
      return manifest.scheduleType === `cron` ? `Cron schedule` : `Future send`
    case `goal`:
      return `Goal`
  }
  return manifest.kind
}

function createParentEntry(parent: DrawerEntity): DrawerEntry {
  const { title } = getEntityDisplayTitle(parent)
  return {
    key: `parent:${parent.url}`,
    groupKey: `parent`,
    groupLabel: `Parent`,
    title: parent.url,
    meta: title === parent.url ? parent.type : title,
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
        title: url,
        meta: manifest.observed ? `child entity` : `child entity · unobserved`,
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
          title: manifest.sourceRef,
          meta: `entity source`,
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

    case `attachment`:
      return {
        key: manifest.key,
        groupKey: `attachment`,
        groupLabel: `Attachments`,
        title: attachmentDisplayName(manifest),
        meta: `${manifest.mimeType} · ${manifest.status}`,
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

    // Goal entries are surfaced via the `GoalBanner` above the timeline,
    // not the manifest drawer.
    case `goal`:
      return null
  }
  return null
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
  baseUrl,
  entityUrl,
  onSelect,
  onOpenSide,
  onPreviewAttachment,
}: {
  group: DrawerGroup
  baseUrl: string
  entityUrl: string
  onSelect: (entry: DrawerEntry) => void
  onOpenSide: (entry: DrawerEntry) => void
  onPreviewAttachment: (attachment: AttachmentImagePreviewItem) => void
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
            baseUrl={baseUrl}
            entityUrl={entityUrl}
            canOpenSide={canOpenSide && entry.action.kind !== `inspect`}
            onSelect={onSelect}
            onOpenSide={onOpenSide}
            onPreviewAttachment={onPreviewAttachment}
          />
        ))}
    </div>
  )
}

function ManifestRow({
  entry,
  baseUrl,
  entityUrl,
  canOpenSide,
  onSelect,
  onOpenSide,
  onPreviewAttachment,
}: {
  entry: DrawerEntry
  baseUrl: string
  entityUrl: string
  canOpenSide: boolean
  onSelect: (entry: DrawerEntry) => void
  onOpenSide: (entry: DrawerEntry) => void
  onPreviewAttachment: (attachment: AttachmentImagePreviewItem) => void
}): React.ReactElement {
  const previewAttachment = createAttachmentPreviewItem(
    entry,
    baseUrl,
    entityUrl
  )

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
      {previewAttachment && (
        <Tooltip content="Preview attachment">
          <IconButton
            type="button"
            size={1}
            variant="ghost"
            tone="neutral"
            className={styles.sideButton}
            aria-label={`Preview ${entry.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onPreviewAttachment(previewAttachment)
            }}
          >
            <Icon icon={ExternalLink} size={1} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  )
}

function createAttachmentPreviewItem(
  entry: DrawerEntry,
  baseUrl: string,
  entityUrl: string
): AttachmentImagePreviewItem | null {
  if (!entry.manifest || !isAttachmentManifest(entry.manifest)) return null
  const attachment = entry.manifest
  if (
    attachment.status !== `complete` ||
    !attachment.mimeType.startsWith(`image/`)
  ) {
    return null
  }
  return {
    name: attachmentDisplayName(attachment),
    mimeType: attachment.mimeType,
    byteLength: attachment.byteLength,
    url: attachmentDownloadUrl(baseUrl, entityUrl, attachment.id),
  }
}
