import type { ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { IconButton, ScrollArea, Stack, Text, Tooltip } from '../../ui'
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
  children,
}: {
  title: string
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
                <PanelLeft size={16} />
              </IconButton>
            </Tooltip>
          </span>
        )}
        <Text size={2} weight={`medium`} className={styles.headerTitle}>
          {title}
        </Text>
      </div>
      <ScrollArea className={styles.scroll}>
        <div className={styles.body}>
          <h1 className={styles.pageTitle}>{title}</h1>
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
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}): React.ReactElement {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description && (
          <p className={styles.sectionDescription}>{description}</p>
        )}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
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
}: {
  label: ReactNode
  description?: ReactNode
  control: ReactNode
}): React.ReactElement {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description && (
          <span className={styles.rowDescription}>{description}</span>
        )}
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  )
}
