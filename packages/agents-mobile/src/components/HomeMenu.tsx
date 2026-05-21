import { useMemo, useState } from 'react'
import { Text } from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from './BottomSheet'
import { Icon } from './Icon'
import { useAgents } from '../lib/AgentsProvider'
import {
  SIDEBAR_GROUP_BY_LABELS,
  SIDEBAR_GROUP_BY_OPTIONS,
  setSidebarGroupBy,
  toggleSidebarStatusVisibility,
  toggleSidebarTypeVisibility,
  useSidebarPrefs,
} from '../lib/sidebarPrefs'
import {
  setThemePreference,
  THEME_PREFERENCE_LABELS,
  THEME_PREFERENCE_OPTIONS,
  useThemePreference,
  type ThemePreference,
} from '../lib/themePref'
import { useTokens } from '../lib/ThemeProvider'

const STATUSES: ReadonlyArray<string> = [
  `spawning`,
  `running`,
  `idle`,
  `stopped`,
]

export type ServerHealth = `ok` | `down` | `unset`

/**
 * Bottom-sheet "more" menu for the home screen — combines the actions
 * the old `<SidebarFooter>` exposed (server, filter, settings) into a
 * single ChatGPT-style kebab popover. Submenus drill in/out of:
 *
 *   - root (default): Server / Group / Show / Theme / Diagnostics
 *   - type: per-type visibility checkboxes
 *   - status: per-status visibility checkboxes
 */
export function HomeMenu({
  open,
  onClose,
  serverHealth,
  onChangeServer,
  onOpenDiagnostics,
}: {
  open: boolean
  onClose: () => void
  serverHealth: ServerHealth
  onChangeServer: () => void
  onOpenDiagnostics: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const { serverUrl, entitiesCollection } = useAgents()
  const prefs = useSidebarPrefs()
  const themePreference = useThemePreference()
  const [page, setPage] = useState<`root` | `type` | `status`>(`root`)

  const { data: entities = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .orderBy(({ entity }) => entity.updated_at, `desc`),
    [entitiesCollection]
  )

  const distinctTypes = useMemo(() => {
    const seen = new Set<string>()
    for (const entity of entities) seen.add(entity.type)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [entities])

  const serverName = useMemo(() => {
    try {
      return new URL(serverUrl).host || serverUrl
    } catch {
      return serverUrl
    }
  }, [serverUrl])

  const dotColor =
    serverHealth === `ok`
      ? tokens.green9
      : serverHealth === `down`
        ? tokens.red9
        : tokens.gray8

  const handleClose = (): void => {
    onClose()
    // Reset the submenu so the next open shows the root page. Done
    // after the dismiss animation so the user doesn't see a flash.
    setTimeout(() => setPage(`root`), 150)
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={
        page === `root`
          ? undefined
          : page === `type`
            ? `Show types`
            : `Show statuses`
      }
    >
      {page === `root` && (
        <RootPage
          serverName={serverName}
          dotColor={dotColor}
          themePreference={themePreference}
          groupBy={prefs.groupBy}
          onShowTypes={() => setPage(`type`)}
          onShowStatuses={() => setPage(`status`)}
          onChangeServer={() => {
            handleClose()
            onChangeServer()
          }}
          onOpenDiagnostics={() => {
            handleClose()
            onOpenDiagnostics()
          }}
        />
      )}

      {page === `type` && (
        <SubPage
          onBack={() => setPage(`root`)}
          rows={
            distinctTypes.length === 0
              ? [{ key: `_empty`, label: `No types yet`, onPress: () => {} }]
              : distinctTypes.map((type) => ({
                  key: type,
                  label: titleCase(type),
                  active: !prefs.hiddenTypes.has(type),
                  onPress: () => toggleSidebarTypeVisibility(type),
                }))
          }
        />
      )}

      {page === `status` && (
        <SubPage
          onBack={() => setPage(`root`)}
          rows={STATUSES.map((status) => ({
            key: status,
            label: titleCase(status),
            active: !prefs.hiddenStatuses.has(status),
            onPress: () => toggleSidebarStatusVisibility(status),
          }))}
        />
      )}
    </BottomSheet>
  )
}

function RootPage({
  serverName,
  dotColor,
  themePreference,
  groupBy,
  onShowTypes,
  onShowStatuses,
  onChangeServer,
  onOpenDiagnostics,
}: {
  serverName: string
  dotColor: string
  themePreference: ThemePreference
  groupBy: `date` | `type` | `status`
  onShowTypes: () => void
  onShowStatuses: () => void
  onChangeServer: () => void
  onOpenDiagnostics: () => void
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <>
      <BottomSheetSection label="Server">
        <BottomSheetItem
          label={serverName}
          icon={<Text style={{ color: dotColor, fontSize: 14 }}>●</Text>}
          trailing={
            <Icon name="swap" size={18} color={tokens.text3} strokeWidth={2} />
          }
          onPress={onChangeServer}
        />
      </BottomSheetSection>

      <BottomSheetSeparator />

      <BottomSheetSection label="Group by">
        {SIDEBAR_GROUP_BY_OPTIONS.map((opt) => (
          <BottomSheetItem
            key={opt}
            label={SIDEBAR_GROUP_BY_LABELS[opt]}
            active={groupBy === opt}
            onPress={() => setSidebarGroupBy(opt)}
          />
        ))}
      </BottomSheetSection>

      <BottomSheetSeparator />

      <BottomSheetSection label="Show">
        <BottomSheetItem
          label="Types"
          icon={
            <Icon
              name="filter"
              size={18}
              color={tokens.text2}
              strokeWidth={2}
            />
          }
          trailing={
            <Icon
              name="chevron-right"
              size={18}
              color={tokens.text3}
              strokeWidth={2}
            />
          }
          onPress={onShowTypes}
        />
        <BottomSheetItem
          label="Statuses"
          icon={
            <Icon
              name="filter"
              size={18}
              color={tokens.text2}
              strokeWidth={2}
            />
          }
          trailing={
            <Icon
              name="chevron-right"
              size={18}
              color={tokens.text3}
              strokeWidth={2}
            />
          }
          onPress={onShowStatuses}
        />
      </BottomSheetSection>

      <BottomSheetSeparator />

      <BottomSheetSection label="Theme">
        {THEME_PREFERENCE_OPTIONS.map((option) => (
          <BottomSheetItem
            key={option}
            label={THEME_PREFERENCE_LABELS[option]}
            icon={
              <Icon
                name={
                  option === `light`
                    ? `sun`
                    : option === `dark`
                      ? `moon`
                      : `system`
                }
                size={18}
                color={tokens.text2}
                strokeWidth={2}
              />
            }
            active={themePreference === option}
            onPress={() => setThemePreference(option)}
          />
        ))}
      </BottomSheetSection>

      <BottomSheetSeparator />

      <BottomSheetItem
        label="Diagnostics"
        icon={
          <Icon name="info" size={18} color={tokens.text2} strokeWidth={2} />
        }
        onPress={onOpenDiagnostics}
      />
    </>
  )
}

function SubPage({
  onBack,
  rows,
}: {
  onBack: () => void
  rows: ReadonlyArray<{
    key: string
    label: string
    active?: boolean
    onPress: () => void
  }>
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <>
      <BottomSheetItem
        label="Back"
        icon={
          <Icon name="back" size={18} color={tokens.text2} strokeWidth={2} />
        }
        onPress={onBack}
      />
      <BottomSheetSeparator />
      {rows.map((row) => (
        <BottomSheetItem
          key={row.key}
          label={row.label}
          active={row.active}
          onPress={row.onPress}
        />
      ))}
    </>
  )
}

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}
