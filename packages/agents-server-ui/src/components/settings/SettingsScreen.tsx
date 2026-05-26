import type { ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import {
  Badge,
  Icon,
  IconButton,
  ScrollArea,
  Stack,
  Tooltip,
  type BadgeTone,
} from '../../ui'
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed'
import { useNarrowViewport } from '../../hooks/useNarrowViewport'
import { modKeyLabel } from '../../lib/keyLabels'
import styles from './SettingsScreen.module.css'

/**
 * Right-hand pane of the settings screen. Holds the title bar (with
 * the desktop drag region) and the scrollable category content area.
 *
 *   <SettingsScreen title="General">
 *     <SettingsSection title="API keys" description="…">
 *       …
 *     </SettingsSection>
 *   </SettingsScreen>
 *
 * The shell is intentionally thin — every category page composes its
 * own sections inside `<SettingsScreen>`, mirroring the pattern of
 * the macOS System Settings layout shown in the user's reference
 * screenshot.
 */
export function SettingsScreen({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}): React.ReactElement {
  // On narrow viewports the SettingsSidebar floats over the
  // content as an overlay (see SettingsSidebar.tsx). Once dismissed
  // via the backdrop, the SettingsScreen is the only thing on
  // screen — without an affordance here the user has no visual
  // way to bring the sidebar back. Mirrors MainHeader's pattern
  // of only showing the chrome cluster when the sidebar is
  // collapsed; while it's open the backdrop is the close UX.
  const narrow = useNarrowViewport()
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed()
  const showToggle = narrow && collapsed
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {showToggle && (
          <span className={styles.chrome}>
            <Tooltip content="Show sidebar" shortcut={modKeyLabel(`b`)}>
              <IconButton
                variant="ghost"
                tone="neutral"
                size={1}
                onClick={toggleSidebar}
                aria-label="Show sidebar"
              >
                <Icon icon={PanelLeft} size={3} />
              </IconButton>
            </Tooltip>
          </span>
        )}
      </div>
      <ScrollArea className={styles.scroll}>
        <div className={styles.body} data-desktop-selection-context>
          <div className={styles.pageTitleRow}>
            <h1 className={styles.pageTitle}>{title}</h1>
            {action && <div className={styles.pageAction}>{action}</div>}
          </div>
          <Stack direction="column" gap={6} className={styles.sections}>
            {children}
          </Stack>
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Logical group inside a settings page. Each section gets a heading
 * + optional description and renders its content in a card-like
 * surface so the page reads as a list of bordered groupings (matching
 * the reference screenshot).
 */
export function SettingsSection({
  title,
  description,
  action,
  actionAlign = `title`,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  actionAlign?: `title` | `description`
  children?: ReactNode
}): React.ReactElement {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div className={styles.sectionHeaderText}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {description && (
            <p className={styles.sectionDescription}>{description}</p>
          )}
        </div>
        {action && (
          <div className={styles.sectionAction} data-align={actionAlign}>
            {action}
          </div>
        )}
      </header>
      {children && <div className={styles.sectionBody}>{children}</div>}
    </section>
  )
}

export function SettingsPanel({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  return <div className={styles.panel}>{children}</div>
}

export function SettingsActions({
  children,
  separator = false,
}: {
  children: ReactNode
  separator?: boolean
}): React.ReactElement {
  return (
    <div
      className={styles.actions}
      data-separator={separator ? `true` : undefined}
    >
      {children}
    </div>
  )
}

export function SettingsInset({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  return <div className={styles.inset}>{children}</div>
}

export type SettingsStatusTone = Extract<
  BadgeTone,
  `neutral` | `success` | `warning` | `danger` | `info`
>

export function SettingsStatusBadge({
  children,
  tone,
}: {
  children: ReactNode
  tone: SettingsStatusTone
}): React.ReactElement {
  return (
    <Badge size={1} tone={tone} className={styles.statusBadge}>
      {children}
    </Badge>
  )
}

/**
 * Single labelled row inside a section card. Pattern matches the
 * macOS Settings layout: label on the left, control on the right.
 */
export function SettingsRow({
  label,
  description,
  control,
  wrapControlValue,
  splitLayout,
  stackedControl,
}: {
  label: ReactNode
  description?: ReactNode
  control: ReactNode
  wrapControlValue?: boolean
  splitLayout?: boolean
  stackedControl?: boolean
}): React.ReactElement {
  const layout = stackedControl ? `stacked` : splitLayout ? `split` : undefined

  return (
    <div className={styles.row} data-layout={layout}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description && (
          <span className={styles.rowDescription}>{description}</span>
        )}
      </div>
      <div
        className={`${styles.rowControl} ${
          wrapControlValue ? styles.wrapControlValue : ``
        }`}
      >
        {control}
      </div>
    </div>
  )
}
