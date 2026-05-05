import type { ReactNode } from 'react'
import { ScrollArea, Stack, Text } from '../../ui'
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
  return (
    <div className={styles.root}>
      <div className={styles.header}>
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
