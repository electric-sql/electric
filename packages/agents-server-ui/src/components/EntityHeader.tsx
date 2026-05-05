import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { Badge, IconButton, Text, Tooltip } from '../ui'
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
  /** ID of the currently-rendered view for this entity. */
  currentViewId?: ViewId
  /** Switch the rendered view in-place (no layout change). */
  onSetView?: (viewId: ViewId) => void
  /**
   * Optional slot for the tile menu (the `…` button at the right edge).
   * The workspace passes its `<SplitMenu>` here. Kept generic so the
   * header doesn't need to know about tiles / groups / splits.
   */
  menu?: ReactNode
  /** Optional banner of error messages displayed below the strip. */
  errors?: Array<string>
}

/**
 * Top of an entity tile. A flat strip with the session name + id on
 * the left and an actions cluster on the right (view-toggle icons +
 * caller-supplied menu), plus a thin error strip below when actions
 * surface errors.
 *
 * No border-bottom — the strip shares the chat background so the
 * header reads as part of the same surface as the conversation below.
 */
export function EntityHeader({
  entity,
  currentViewId,
  onSetView,
  menu,
  errors,
}: EntityHeaderProps): React.ReactElement | null {
  return (
    <>
      <MainHeader
        title={<EntityTitle entity={entity} />}
        actions={
          <EntityActions
            entity={entity}
            currentViewId={currentViewId}
            onSetView={onSetView}
            menu={menu}
          />
        }
      />
      {errors && errors.length > 0 && (
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
  currentViewId,
  onSetView,
  menu,
}: Pick<
  EntityHeaderProps,
  `entity` | `currentViewId` | `onSetView` | `menu`
>): React.ReactElement {
  // The view registry is the source of truth for which view buttons
  // appear. `defaultViewId` is the first registered view (`chat`) and
  // is treated as implicit when no current view is set.
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

      {menu}
    </span>
  )
}
