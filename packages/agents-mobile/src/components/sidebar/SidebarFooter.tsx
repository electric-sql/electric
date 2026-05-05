import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSection,
  BottomSheetSeparator,
} from '../BottomSheet'
import { FooterIconButton } from './FooterIconButton'
import { ServerPickerTile, type ServerStatus } from './ServerPickerTile'
import { useAgents } from '../../lib/AgentsProvider'
import {
  SIDEBAR_GROUP_BY_LABELS,
  SIDEBAR_GROUP_BY_OPTIONS,
  setSidebarGroupBy,
  toggleSidebarStatusVisibility,
  toggleSidebarTypeVisibility,
  useSidebarPrefs,
  type SidebarGroupBy,
} from '../../lib/sidebarPrefs'
import {
  setThemePreference,
  THEME_PREFERENCE_LABELS,
  THEME_PREFERENCE_OPTIONS,
  useThemePreference,
} from '../../lib/themePref'
import { useTokens } from '../../lib/ThemeProvider'
import { spacing } from '../../lib/theme'
import type { Tokens } from '../../lib/theme'

const STATUSES: ReadonlyArray<string> = [
  `spawning`,
  `running`,
  `idle`,
  `stopped`,
]

const GROUP_BY_GLYPHS: Record<SidebarGroupBy, string> = {
  date: `🗓`,
  type: `#`,
  status: `●`,
}

const THEME_GLYPHS: Record<string, string> = {
  system: `⌘`,
  light: `☀`,
  dark: `☾`,
}

/**
 * Footer-anchored controls for the mobile sidebar — mirrors the web
 * `<SidebarFooter>`:
 *
 *   [ServerPickerTile (flex)]  [Filter ⛗]  [Settings ⚙]
 *
 * Tapping the tile opens a bottom-sheet listing saved + add server.
 * The two trailing icon buttons open filter / settings sheets.
 */
export function SidebarFooter({
  serverStatus,
  onChangeServer,
  onOpenDiagnostics,
}: {
  serverStatus: ServerStatus
  onChangeServer: () => void
  onOpenDiagnostics: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { serverUrl, entitiesCollection } = useAgents()
  const prefs = useSidebarPrefs()
  const themePreference = useThemePreference()

  const [serverOpen, setServerOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filterCategory, setFilterCategory] = useState<
    `root` | `type` | `status`
  >(`root`)

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

  return (
    <View style={styles.footer}>
      <ServerPickerTile
        name={serverName}
        status={serverStatus}
        onPress={() => setServerOpen(true)}
      />
      <FooterIconButton
        onPress={() => {
          setFilterCategory(`root`)
          setFilterOpen(true)
        }}
        accessibilityLabel="Filter & view options"
      >
        <Text style={{ color: tokens.text2, fontSize: 14, lineHeight: 16 }}>
          ⛗
        </Text>
      </FooterIconButton>
      <FooterIconButton
        onPress={() => setSettingsOpen(true)}
        accessibilityLabel="Settings"
      >
        <Text style={{ color: tokens.text2, fontSize: 14, lineHeight: 16 }}>
          ⚙
        </Text>
      </FooterIconButton>

      {/* Server picker sheet ----------------------------------- */}
      <BottomSheet
        open={serverOpen}
        onClose={() => setServerOpen(false)}
        title="Server"
      >
        <BottomSheetItem
          label={serverName}
          icon={<Text style={{ color: tokens.green9, fontSize: 14 }}>●</Text>}
          active
          onPress={() => setServerOpen(false)}
        />
        <BottomSheetSeparator />
        <BottomSheetItem
          label="Change server"
          icon={<Text style={{ color: tokens.text2, fontSize: 16 }}>↻</Text>}
          onPress={() => {
            setServerOpen(false)
            onChangeServer()
          }}
        />
      </BottomSheet>

      {/* Filter sheet ----------------------------------------- */}
      <BottomSheet
        open={filterOpen}
        onClose={() => {
          setFilterOpen(false)
          setFilterCategory(`root`)
        }}
        title={
          filterCategory === `root`
            ? `Filter & view`
            : filterCategory === `type`
              ? `Show types`
              : `Show statuses`
        }
      >
        {filterCategory === `root` && (
          <>
            <BottomSheetSection label="Group by">
              {SIDEBAR_GROUP_BY_OPTIONS.map((opt) => (
                <BottomSheetItem
                  key={opt}
                  label={SIDEBAR_GROUP_BY_LABELS[opt]}
                  icon={
                    <Text style={{ color: tokens.text2, fontSize: 14 }}>
                      {GROUP_BY_GLYPHS[opt]}
                    </Text>
                  }
                  active={prefs.groupBy === opt}
                  onPress={() => setSidebarGroupBy(opt)}
                />
              ))}
            </BottomSheetSection>
            <BottomSheetSeparator />
            <BottomSheetSection label="Show">
              <BottomSheetItem
                label="Types"
                icon={
                  <Text style={{ color: tokens.text2, fontSize: 14 }}>#</Text>
                }
                trailing={
                  <Text style={{ color: tokens.text3, fontSize: 16 }}>›</Text>
                }
                onPress={() => setFilterCategory(`type`)}
              />
              <BottomSheetItem
                label="Statuses"
                icon={
                  <Text style={{ color: tokens.text2, fontSize: 14 }}>●</Text>
                }
                trailing={
                  <Text style={{ color: tokens.text3, fontSize: 16 }}>›</Text>
                }
                onPress={() => setFilterCategory(`status`)}
              />
            </BottomSheetSection>
          </>
        )}
        {filterCategory === `type` && (
          <>
            <BottomSheetItem
              label="‹ Back"
              onPress={() => setFilterCategory(`root`)}
            />
            <BottomSheetSeparator />
            {distinctTypes.length === 0 ? (
              <BottomSheetItem label="No types yet" onPress={() => {}} />
            ) : (
              distinctTypes.map((type) => {
                const visible = !prefs.hiddenTypes.has(type)
                return (
                  <BottomSheetItem
                    key={type}
                    label={titleCase(type)}
                    active={visible}
                    icon={
                      <Text style={{ color: tokens.text2, fontSize: 14 }}>
                        {visible ? `◉` : `○`}
                      </Text>
                    }
                    onPress={() => toggleSidebarTypeVisibility(type)}
                  />
                )
              })
            )}
          </>
        )}
        {filterCategory === `status` && (
          <>
            <BottomSheetItem
              label="‹ Back"
              onPress={() => setFilterCategory(`root`)}
            />
            <BottomSheetSeparator />
            {STATUSES.map((status) => {
              const visible = !prefs.hiddenStatuses.has(status)
              return (
                <BottomSheetItem
                  key={status}
                  label={titleCase(status)}
                  active={visible}
                  icon={
                    <Text style={{ color: tokens.text2, fontSize: 14 }}>
                      {visible ? `◉` : `○`}
                    </Text>
                  }
                  onPress={() => toggleSidebarStatusVisibility(status)}
                />
              )
            })}
          </>
        )}
      </BottomSheet>

      {/* Settings sheet --------------------------------------- */}
      <BottomSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
      >
        <BottomSheetSection label="Theme">
          {THEME_PREFERENCE_OPTIONS.map((option) => (
            <BottomSheetItem
              key={option}
              label={THEME_PREFERENCE_LABELS[option]}
              icon={
                <Text style={{ color: tokens.text2, fontSize: 14 }}>
                  {THEME_GLYPHS[option] ?? `•`}
                </Text>
              }
              active={themePreference === option}
              onPress={() => setThemePreference(option)}
            />
          ))}
        </BottomSheetSection>
        <BottomSheetSeparator />
        <BottomSheetItem
          label="Diagnostics"
          icon={<Text style={{ color: tokens.text2, fontSize: 14 }}>ⓘ</Text>}
          onPress={() => {
            setSettingsOpen(false)
            onOpenDiagnostics()
          }}
        />
      </BottomSheet>
    </View>
  )
}

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    footer: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.xs,
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: tokens.divider,
      backgroundColor: tokens.bg,
    },
  })
}
