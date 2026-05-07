import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Box, Icon, Stack } from '../ui'
import toolBlock from './toolBlock.module.css'
import type { LucideIcon } from 'lucide-react'

export function InlineEventCard({
  icon,
  title,
  summary,
  badge,
  actions,
  collapsible,
  defaultExpanded = false,
  headerSurface = false,
  titleFont = `body`,
  children,
}: {
  icon: LucideIcon
  title: string
  summary?: string | null
  badge?: React.ReactNode
  actions?: React.ReactNode
  collapsible?: boolean
  defaultExpanded?: boolean
  headerSurface?: boolean
  titleFont?: `body` | `mono`
  children?: React.ReactNode
}): React.ReactElement {
  const expandable =
    children !== undefined && (collapsible ?? actions === undefined)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const showBody = children !== undefined && (!expandable || expanded)
  const headerOnly = children === undefined
  const headerContent = (
    <>
      <span className={toolBlock.headerIcon} aria-hidden="true">
        <Icon icon={icon} size={2} />
      </span>
      <span
        className={
          titleFont === `mono` ? toolBlock.toolNameMono : toolBlock.toolName
        }
      >
        {title}
      </span>
      {summary ? <span className={toolBlock.summary}>{summary}</span> : null}
      {badge}
      {actions ? (
        <span className={toolBlock.headerActions}>{actions}</span>
      ) : null}
      {expandable ? (
        <span className={toolBlock.toggleArrow} aria-hidden="true">
          {expanded ? (
            <Icon icon={ChevronDown} size={1} />
          ) : (
            <Icon icon={ChevronRight} size={1} />
          )}
        </span>
      ) : null}
    </>
  )

  return (
    <Stack
      direction="column"
      className={toolBlock.card}
      data-header-surface={headerOnly || headerSurface ? `true` : undefined}
    >
      {expandable ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`${toolBlock.header} ${toolBlock.headerToggle}`}
        >
          {headerContent}
        </button>
      ) : (
        <Stack align="center" gap={2} className={toolBlock.header}>
          {headerContent}
        </Stack>
      )}
      {showBody ? <Box className={toolBlock.body}>{children}</Box> : null}
    </Stack>
  )
}
