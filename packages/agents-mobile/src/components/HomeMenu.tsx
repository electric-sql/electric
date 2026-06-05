import { useMemo, useState } from 'react'
import { Animated, StyleSheet, Text } from 'react-native'
import { eq, not, useLiveQuery } from '@tanstack/react-db'
import {
  normalizePrincipalUrl,
  principalKeyFromInput,
  userIdFromPrincipal,
} from '@electric-ax/agents-server-ui/src/lib/principals'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from './BottomSheet'
import { Icon } from './Icon'
import { useDrillTransition } from './useDrillTransition'
import { useAgents } from '../lib/AgentsProvider'
import { useMobileAppState } from '../lib/MobileAppState'
import { useCloudAuth } from '../lib/CloudAuthContext'
import { useAvailableServers } from '../lib/useAvailableServers'
import { addSavedServer } from '../lib/savedServers'
import { getCloudServiceIdFromServerUrl } from '../lib/cloudAgentUrls'
import { prepareServerHeaders } from '../lib/serverHeaders'
import {
  SIDEBAR_GROUP_BY_LABELS,
  SIDEBAR_GROUP_BY_OPTIONS,
  setSidebarGroupBy,
  toggleSidebarCreatorVisibility,
  toggleSidebarStatusVisibility,
  toggleSidebarTypeVisibility,
  useSidebarPrefs,
} from '../lib/sidebarPrefs'
import { useCurrentPrincipal } from '../lib/useCurrentPrincipal'
import {
  setThemePreference,
  THEME_PREFERENCE_LABELS,
  THEME_PREFERENCE_OPTIONS,
  useThemePreference,
  type ThemePreference,
} from '../lib/themePref'
import { useTokens } from '../lib/ThemeProvider'
import type { AvailableServer } from '../lib/useAvailableServers'
import type { ElectricUser } from '../lib/agentsClient'

const STATUSES: ReadonlyArray<string> = [
  `spawning`,
  `running`,
  `idle`,
  `stopped`,
]

export type ServerHealth = `ok` | `down` | `unset`

type Page = `root` | `server` | `type` | `status` | `creator`

/**
 * Bottom-sheet "more" menu for the home screen — combines the actions
 * the old `<SidebarFooter>` exposed (server, filter, settings) into a
 * single ChatGPT-style kebab popover. Submenus slide in/out (via
 * `useDrillTransition`) between:
 *
 *   - root (default): Server / Group / Show / Theme / Account / Diagnostics
 *   - server: unified list of saved + Cloud agent servers
 *   - type: per-type visibility checkboxes
 *   - status: per-status visibility checkboxes
 *   - creator: per-principal visibility checkboxes
 */
export function HomeMenu({
  open,
  onClose,
  serverHealth,
  onChangeServer,
  onOpenDiagnostics,
  onOpenAccount,
}: {
  open: boolean
  onClose: () => void
  serverHealth: ServerHealth
  onChangeServer: () => void
  onOpenDiagnostics: () => void
  onOpenAccount: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const { serverUrl, entitiesCollection, usersCollection } = useAgents()
  const prefs = useSidebarPrefs()
  const themePreference = useThemePreference()
  const [page, setPage] = useState<Page>(`root`)
  const { style: drillStyle, drill, reset: resetDrill } = useDrillTransition()
  const { principal: currentPrincipal } = useCurrentPrincipal()
  const currentPrincipalUrl = useMemo(
    () => normalizePrincipalUrl(currentPrincipal),
    [currentPrincipal]
  )

  const { data: entities = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .where(({ entity }) => not(eq(entity.type, `principal`)))
        .orderBy(({ entity }) => entity.updated_at, `desc`),
    [entitiesCollection]
  )

  const { data: users = [] } = useLiveQuery(
    (query) => query.from({ user: usersCollection }),
    [usersCollection]
  )

  const distinctTypes = useMemo(() => {
    const seen = new Set<string>()
    for (const entity of entities) seen.add(entity.type)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [entities])
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  )
  const creatorOptions = useMemo(() => {
    const seen = new Set<string>()
    if (currentPrincipalUrl) seen.add(currentPrincipalUrl)
    for (const entity of entities) {
      const creator = normalizePrincipalUrl(entity.created_by)
      if (creator) seen.add(creator)
    }

    return Array.from(seen)
      .map((principal) =>
        principalFilterOption(principal, {
          currentPrincipalUrl,
          usersById,
        })
      )
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
        return a.label.localeCompare(b.label)
      })
  }, [currentPrincipalUrl, entities, usersById])

  const availableServers = useAvailableServers()

  const serverName = useMemo(() => {
    const active = availableServers.find((s) => s.isActive)
    if (active) return active.name
    try {
      return new URL(serverUrl).host || serverUrl
    } catch {
      return serverUrl
    }
  }, [availableServers, serverUrl])

  const dotColor =
    serverHealth === `ok`
      ? tokens.green9
      : serverHealth === `down`
        ? tokens.red9
        : tokens.gray8

  const handleClose = (): void => {
    onClose()
    // Reset the submenu so the next open shows the root page. Done after
    // the dismiss animation completes (BottomSheet closes over 190ms, the
    // drill transition over 180ms) so the pane doesn't visibly snap back
    // to root mid-close.
    setTimeout(() => {
      setPage(`root`)
      resetDrill()
    }, 200)
  }

  const goTo = (next: Page, direction: 1 | -1): void => {
    setPage(next)
    drill(direction)
  }

  const title =
    page === `server`
      ? `Server`
      : page === `type`
        ? `Show types`
        : page === `status`
          ? `Show statuses`
          : page === `creator`
            ? `Created by`
            : undefined

  return (
    <BottomSheet open={open} onClose={handleClose} title={title}>
      <Animated.View style={[styles.drillPane, drillStyle]}>
        {page === `root` && (
          <RootPage
            serverName={serverName}
            dotColor={dotColor}
            themePreference={themePreference}
            groupBy={prefs.groupBy}
            onShowServers={() => goTo(`server`, 1)}
            onShowTypes={() => goTo(`type`, 1)}
            onShowStatuses={() => goTo(`status`, 1)}
            onShowCreators={() => goTo(`creator`, 1)}
            onOpenDiagnostics={() => {
              handleClose()
              onOpenDiagnostics()
            }}
            onOpenAccount={() => {
              handleClose()
              onOpenAccount()
            }}
          />
        )}

        {page === `server` && (
          <ServerListPage
            servers={availableServers}
            onBack={() => goTo(`root`, -1)}
            onClose={handleClose}
            onAddCustom={() => {
              handleClose()
              onChangeServer()
            }}
          />
        )}

        {page === `type` && (
          <SubPage
            onBack={() => goTo(`root`, -1)}
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
            onBack={() => goTo(`root`, -1)}
            rows={STATUSES.map((status) => ({
              key: status,
              label: titleCase(status),
              active: !prefs.hiddenStatuses.has(status),
              onPress: () => toggleSidebarStatusVisibility(status),
            }))}
          />
        )}

        {page === `creator` && (
          <SubPage
            onBack={() => goTo(`root`, -1)}
            rows={
              creatorOptions.length === 0
                ? [
                    {
                      key: `_empty`,
                      label: `No creators yet`,
                      disabled: true,
                      onPress: () => {},
                    },
                  ]
                : creatorOptions.map((creator) => ({
                    key: creator.principal,
                    label: creator.label,
                    subtitle: creator.principalKey,
                    active: !prefs.hiddenCreators.has(creator.principal),
                    onPress: () =>
                      toggleSidebarCreatorVisibility(creator.principal),
                  }))
            }
          />
        )}
      </Animated.View>
    </BottomSheet>
  )
}

function RootPage({
  serverName,
  dotColor,
  themePreference,
  groupBy,
  onShowServers,
  onShowTypes,
  onShowStatuses,
  onShowCreators,
  onOpenDiagnostics,
  onOpenAccount,
}: {
  serverName: string
  dotColor: string
  themePreference: ThemePreference
  groupBy: `date` | `type` | `status`
  onShowServers: () => void
  onShowTypes: () => void
  onShowStatuses: () => void
  onShowCreators: () => void
  onOpenDiagnostics: () => void
  onOpenAccount: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const { state: cloudState } = useCloudAuth()
  const isSignedIn = cloudState.status === `signed-in`
  const accountLabel = isSignedIn
    ? (cloudState.name ?? cloudState.email ?? `Account`)
    : `Sign in to Electric Cloud`
  const accountSubtitle =
    isSignedIn && cloudState.name && cloudState.email
      ? cloudState.email
      : undefined

  return (
    <>
      <BottomSheetSection label="Server">
        <BottomSheetItem
          label={serverName}
          icon={<Text style={{ color: dotColor, fontSize: 14 }}>●</Text>}
          trailing={
            <Icon
              name="chevron-right"
              size={18}
              color={tokens.text3}
              strokeWidth={2}
            />
          }
          onPress={onShowServers}
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
        <BottomSheetItem
          label="Created by"
          icon={
            <Icon name="users" size={18} color={tokens.text2} strokeWidth={2} />
          }
          trailing={
            <Icon
              name="chevron-right"
              size={18}
              color={tokens.text3}
              strokeWidth={2}
            />
          }
          onPress={onShowCreators}
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
        label={accountLabel}
        subtitle={accountSubtitle}
        icon={
          <Icon name="user" size={18} color={tokens.text2} strokeWidth={2} />
        }
        trailing={
          <Icon
            name="chevron-right"
            size={18}
            color={tokens.text3}
            strokeWidth={2}
          />
        }
        onPress={onOpenAccount}
      />
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

function ServerListPage({
  servers,
  onBack,
  onClose,
  onAddCustom,
}: {
  servers: ReadonlyArray<AvailableServer>
  onBack: () => void
  onClose: () => void
  onAddCustom: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const { saveServerUrl } = useMobileAppState()
  const { state: cloudState } = useCloudAuth()
  const [connectingKey, setConnectingKey] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const selectServer = async (item: AvailableServer): Promise<void> => {
    if (connectingKey) return
    setConnectingKey(item.key)
    setConnectError(null)
    try {
      // For a live Cloud server not yet in the saved list, register its
      // auth headers first — Cloud rejects unauthenticated requests with
      // 401, so this must succeed before we switch to it.
      if (!item.saved && item.kind === `cloud`) {
        await prepareServerHeaders(item.url)
      }
      await saveServerUrl(item.url)
      // Persist only after the switch succeeds, so the saved list never
      // holds a server we couldn't actually connect to.
      if (!item.saved && item.kind === `cloud`) {
        const serviceId = getCloudServiceIdFromServerUrl(item.url)
        addSavedServer({
          id: serviceId ?? item.url,
          name: item.name,
          url: item.url,
          source: `electric-cloud`,
        })
      }
      onClose()
    } catch (err) {
      // Surface the failure in-sheet rather than silently closing the
      // spinner — mirrors ServerSetupScreen's cloudConnectError handling.
      setConnectError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnectingKey(null)
    }
  }

  const emptyHint =
    cloudState.status === `signed-in`
      ? `No agent servers yet. Add a custom server below.`
      : `Sign in from Account to discover Cloud servers, or add a custom server below.`

  return (
    <>
      <BottomSheetSection>
        <BottomSheetItem
          label="Back"
          icon={
            <Icon name="back" size={18} color={tokens.text2} strokeWidth={2} />
          }
          onPress={onBack}
        />
      </BottomSheetSection>
      <BottomSheetSeparator />
      <BottomSheetSection label="Servers">
        {servers.length === 0 ? (
          <Text style={[styles.hint, { color: tokens.text3 }]}>
            {emptyHint}
          </Text>
        ) : (
          servers.map((item) => (
            <BottomSheetItem
              key={item.key}
              label={item.name}
              subtitle={item.breadcrumb}
              active={item.isActive}
              disabled={connectingKey !== null && connectingKey !== item.key}
              icon={
                <Icon
                  name={item.kind === `cloud` ? `cloud` : `server`}
                  size={18}
                  color={tokens.text2}
                  strokeWidth={2}
                />
              }
              trailing={
                connectingKey === item.key ? (
                  <Text style={[styles.connecting, { color: tokens.text3 }]}>
                    …
                  </Text>
                ) : undefined
              }
              onPress={() => {
                void selectServer(item)
              }}
            />
          ))
        )}
        {connectError && (
          <Text style={[styles.errorText, { color: tokens.red11 }]}>
            {connectError}
          </Text>
        )}
      </BottomSheetSection>
      <BottomSheetSeparator />
      <BottomSheetSection>
        <BottomSheetItem
          label="Add custom server…"
          icon={
            <Icon
              name="server"
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
          onPress={onAddCustom}
        />
      </BottomSheetSection>
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
    subtitle?: string
    active?: boolean
    disabled?: boolean
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
          subtitle={row.subtitle}
          active={row.active}
          disabled={row.disabled}
          onPress={row.onPress}
        />
      ))}
    </>
  )
}

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}

function principalFilterOption(
  principal: string,
  {
    currentPrincipalUrl,
    usersById,
  }: {
    currentPrincipalUrl: string | null
    usersById: ReadonlyMap<string, ElectricUser>
  }
): {
  principal: string
  principalKey: string
  label: string
  isCurrent: boolean
} {
  const principalKey = principalKeyFromInput(principal) ?? principal
  const isCurrent = principal === currentPrincipalUrl
  if (isCurrent) {
    return { principal, principalKey, label: `Me`, isCurrent }
  }
  const userId = userIdFromPrincipal(principal)
  const user = userId ? usersById.get(userId) : undefined
  return {
    principal,
    principalKey,
    label: userDisplayName(user) ?? formatPrincipalKey(principalKey),
    isCurrent,
  }
}

function userDisplayName(user: ElectricUser | undefined): string | null {
  if (!user) return null
  return user.display_name || user.email || null
}

function formatPrincipalKey(key: string): string {
  const colon = key.indexOf(`:`)
  if (colon <= 0) return shortenPrincipalId(key)
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  return `${kind}:${shortenPrincipalId(id)}`
}

function shortenPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}

const styles = StyleSheet.create({
  drillPane: {
    overflow: `hidden`,
  },
  hint: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 18,
  },
  connecting: {
    fontSize: 16,
  },
  errorText: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 18,
  },
})
