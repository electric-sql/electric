import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Eye,
  GitFork,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Menu,
  Stack,
  Text,
  Tooltip,
} from '../ui'
import type { BadgeTone } from '../ui'
import { MainHeader } from './MainHeader'
import { listViews, type ViewId } from '../lib/workspace/viewRegistry'
import styles from './EntityHeader.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const STATUS_TONE: Record<string, BadgeTone> = {
  active: `info`,
  running: `info`,
  idle: `success`,
  spawning: `warning`,
  stopped: `neutral`,
}

type EntityHeaderProps = {
  entity: ElectricEntity
  pinned: boolean
  onTogglePin: () => void
  onFork?: () => void
  onKill: () => void
  killError?: string | null
  forkError?: string | null
  forking?: boolean
  /** ID of the currently-rendered view for this entity. */
  currentViewId?: ViewId
  /** Switch the rendered view in-place (no layout change). */
  onSetView?: (viewId: ViewId) => void
}

/**
 * Top of the entity-page column. A flat header strip with the session
 * name + id on the left and an actions cluster on the right, plus a
 * thin error strip below when kill / fork surface errors.
 *
 * No border-bottom — the strip shares the chat background so the
 * header reads as part of the same surface as the conversation below.
 */
export function EntityHeader(
  props: EntityHeaderProps
): React.ReactElement | null {
  const { entity, killError, forkError } = props
  const errors = [killError, forkError].filter(
    (e): e is string => typeof e === `string` && e.length > 0
  )
  return (
    <>
      <MainHeader
        title={<EntityTitle entity={entity} />}
        actions={<EntityActions {...props} />}
      />
      {errors.length > 0 && (
        <div className={styles.errorBar} role="alert">
          {errors.map((msg, i) => (
            <Text key={i} size={1} tone="danger">
              {msg}
            </Text>
          ))}
        </div>
      )}
    </>
  )
}

function EntityTitle({
  entity,
}: {
  entity: ElectricEntity
}): React.ReactElement {
  const { title } = getEntityDisplayTitle(entity)
  // The session id is the URL minus the leading slash (e.g.
  // `horton/gpt5-verify-1777802612`). The type is encoded in the path
  // so a separate type pill would be redundant.
  const sessionId = entity.url.replace(/^\//, ``)
  const decoded = decodeURIComponent(entity.url)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const copy = () => {
    void navigator.clipboard.writeText(sessionId)
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <span className={styles.title}>
      <Text size={2} className={styles.titleName} title={decoded}>
        {title}
      </Text>
      <span className={styles.idGroup} data-copied={copied ? `` : undefined}>
        <button
          type="button"
          className={styles.subtitle}
          title={copied ? `Copied` : `${decoded} — click to copy`}
          onClick={copy}
        >
          {sessionId}
        </button>
        <span className={styles.copyIcon} aria-hidden="true" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </span>
      </span>
    </span>
  )
}

function EntityActions({
  entity,
  pinned,
  onTogglePin,
  onFork,
  onKill,
  forking,
  currentViewId,
  onSetView,
}: EntityHeaderProps): React.ReactElement {
  const [showInspect, setShowInspect] = useState(false)
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const { title: instanceName } = getEntityDisplayTitle(entity)
  // The view registry is the source of truth for which view buttons /
  // menu items appear. `defaultViewId` is the first registered view
  // (`chat`) and is treated as implicit when no current view is set.
  const availableViews = onSetView ? listViews(entity) : []
  const defaultViewId = availableViews[0]?.id
  const activeViewId = currentViewId ?? defaultViewId
  // Only show the inline view-switcher buttons when there's more than
  // one view available — otherwise the strip is just visual noise.
  const showViewStrip = onSetView && availableViews.length > 1

  return (
    <span className={styles.actions}>
      <Badge
        tone={STATUS_TONE[entity.status] ?? `neutral`}
        variant="soft"
        className={styles.statusBadge}
      >
        {entity.status}
      </Badge>

      {showViewStrip &&
        availableViews.map((view) => {
          const Icon = view.icon
          const active = view.id === activeViewId
          return (
            <Tooltip key={view.id} content={view.label}>
              <IconButton
                variant="ghost"
                tone="neutral"
                size={1}
                onClick={() => onSetView!(view.id)}
                aria-label={view.label}
                aria-pressed={active}
                className={active ? styles.activeBg : undefined}
              >
                <Icon size={14} />
              </IconButton>
            </Tooltip>
          )
        })}

      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              variant="ghost"
              tone="neutral"
              size={1}
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal size={16} />
            </IconButton>
          }
        />
        <Menu.Content side="bottom" align="end">
          <Menu.Item onSelect={() => setShowInspect(true)}>
            <Eye size={14} />
            <Text size={2}>Inspect</Text>
          </Menu.Item>
          {onSetView &&
            availableViews
              .filter((v) => v.id !== activeViewId)
              .map((view) => {
                const Icon = view.icon
                return (
                  <Menu.Item key={view.id} onSelect={() => onSetView(view.id)}>
                    <Icon size={14} />
                    <Text size={2}>{view.label}</Text>
                  </Menu.Item>
                )
              })}
          <Menu.Item
            onSelect={() => {
              void navigator.clipboard.writeText(entity.url)
            }}
          >
            <Copy size={14} />
            <Text size={2}>Copy URL</Text>
          </Menu.Item>
          <Menu.Item onSelect={onTogglePin}>
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            <Text size={2}>{pinned ? `Unpin` : `Pin`}</Text>
          </Menu.Item>
          {onFork && (
            <Menu.Item
              onSelect={onFork}
              disabled={forking || entity.status === `stopped`}
            >
              <GitFork size={14} />
              <Text size={2}>{forking ? `Forking…` : `Fork subtree`}</Text>
            </Menu.Item>
          )}
          {entity.status !== `stopped` && (
            <>
              <Menu.Separator />
              {/* Destructive intent is communicated by the verb ("Kill")
                  + the confirm dialog that follows — not by tinting the
                  icon red. Keeps the menu uniformly neutral. */}
              <Menu.Item onSelect={() => setShowKillConfirm(true)}>
                <Trash2 size={14} />
                <Text size={2}>Kill</Text>
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Root>

      <Dialog.Root open={showInspect} onOpenChange={setShowInspect}>
        <Dialog.Content maxWidth={600}>
          <Dialog.Title>Entity details</Dialog.Title>
          <pre className={styles.inspectPre}>
            {JSON.stringify(entity, null, 2)}
          </pre>
          <Stack justify="end" className={styles.dialogActions}>
            <Dialog.Close
              render={
                <Button variant="soft" tone="neutral">
                  Close
                </Button>
              }
            />
          </Stack>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showKillConfirm} onOpenChange={setShowKillConfirm}>
        <Dialog.Content maxWidth={400}>
          <Dialog.Title>Kill entity</Dialog.Title>
          <Text size={2} tone="muted">
            Are you sure you want to kill {instanceName}? The entity will stop
            processing and its stream will become read-only.
          </Text>
          <Stack justify="end" gap={2} className={styles.killActions}>
            <Dialog.Close
              render={
                <Button variant="soft" tone="neutral">
                  Cancel
                </Button>
              }
            />
            <Button
              onClick={() => {
                onKill()
                setShowKillConfirm(false)
              }}
            >
              Kill
            </Button>
          </Stack>
        </Dialog.Content>
      </Dialog.Root>
    </span>
  )
}
