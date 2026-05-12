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
import { useMobileAppState } from '../lib/MobileAppState'
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
 *   - root (default): Servers / Group / Show / Theme / Diagnostics
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
  const { servers, activeServer, setActiveServerUrl } = useMobileAppState()
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

  const serverName = activeServer?.name ?? serverNameFromUrl(serverUrl)

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
          servers={servers}
          activeUrl={activeServer?.url ?? null}
          serverHealth={serverHealth}
          themePreference={themePreference}
          groupBy={prefs.groupBy}
          onAddServer={() => {
            handleClose()
            onChangeServer()
          }}
          onSelectServer={(url) => {
            void setActiveServerUrl(url)
            handleClose()
          }}
          onShowTypes={() => setPage(`type`)}
          onShowStatuses={() => setPage(`status`)}
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
  servers,
  activeUrl,
  serverHealth,
  themePreference,
  groupBy,
  onAddServer,
  onSelectServer,
  onShowTypes,
  onShowStatuses,
  onOpenDiagnostics,
}: {
  serverName: string
  dotColor: string
  servers: ReadonlyArray<{ name: string; url: string }>
  activeUrl: string | null
  serverHealth: ServerHealth
  themePreference: ThemePreference
  groupBy: `date` | `type` | `status`
  onAddServer: () => void
  onSelectServer: (url: string) => void
  onShowTypes: () => void
  onShowStatuses: () => void
  onOpenDiagnostics: () => void
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <>
      <ServerSection
        servers={servers}
        activeUrl={activeUrl}
        serverHealth={serverHealth}
        fallbackServerName={serverName}
        fallbackDotColor={dotColor}
        onAddServer={onAddServer}
        onSelectServer={onSelectServer}
      />

      <BottomSheetSeparator />

      <GroupBySection groupBy={groupBy} />

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

function ServerSection({
  servers,
  activeUrl,
  serverHealth,
  fallbackServerName,
  fallbackDotColor,
  onAddServer,
  onSelectServer,
}: {
  servers: ReadonlyArray<{ name: string; url: string }>
  activeUrl: string | null
  serverHealth: ServerHealth
  fallbackServerName: string
  fallbackDotColor: string
  onAddServer: () => void
  onSelectServer: (url: string) => void
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <BottomSheetSection label="Servers">
      {servers.length === 0 ? (
        <BottomSheetItem
          label={fallbackServerName}
          icon={
            <Text style={{ color: fallbackDotColor, fontSize: 14 }}>●</Text>
          }
          active
          onPress={() => {}}
        />
      ) : (
        servers.map((server) => {
          const active = server.url === activeUrl
          const dotColor = active
            ? serverHealth === `ok`
              ? tokens.green9
              : serverHealth === `down`
                ? tokens.red9
                : tokens.gray8
            : tokens.gray8
          return (
            <BottomSheetItem
              key={server.url}
              label={server.name}
              icon={<Text style={{ color: dotColor, fontSize: 14 }}>●</Text>}
              active={active}
              onPress={() => onSelectServer(server.url)}
            />
          )
        })
      )}
      <BottomSheetItem
        label="Edit servers"
        icon={<Icon name="server" size={18} color={tokens.text2} />}
        onPress={onAddServer}
      />
    </BottomSheetSection>
  )
}

function GroupBySection({
  groupBy,
}: {
  groupBy: `date` | `type` | `status`
}): React.ReactElement {
  return (
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

function serverNameFromUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
