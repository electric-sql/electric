import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import { Fab } from '../components/Fab'
import { Header } from '../components/Header'
import { HomeMenu, type ServerHealth } from '../components/HomeMenu'
import { Screen } from '../components/Screen'
import { SearchBar } from '../components/SearchBar'
import { SessionRow } from '../components/SessionRow'
import { TopBarIconButton } from '../components/TopBarIconButton'
import { useAgents } from '../lib/AgentsProvider'
import { checkServerHealth, getEntityDisplayTitle } from '../lib/agentsClient'
import {
  bucketEntities,
  groupByStatus,
  groupByType,
  type SessionGroup,
} from '../lib/sessionBuckets'
import { useSidebarPrefs } from '../lib/sidebarPrefs'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Home screen — the ChatGPT-mobile-style entry point. Layout is:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Electric Agents          🔍  ⋯               │   <Header>
 *   ├──────────────────────────────────────────────┤
 *   │ Today                                        │
 *   │   Session A                                  │   <SessionRow>
 *   │   Session B                                  │
 *   │ Yesterday                                    │
 *   │   Session C                                  │
 *   │                                              │
 *   │                            [✎ New]           │   <Fab>
 *   └──────────────────────────────────────────────┘
 *
 * Search slides in inline (replacing the header) with debounced
 * filtering by display title; the kebab opens `<HomeMenu>` for
 * server / filter / theme / diagnostics. The FAB launches the new-
 * session flow. We intentionally do not show status dots, type
 * labels, or footers — those affordances live in the kebab.
 */
export function SessionListScreen({
  onOpenSession,
  onNewSession,
  onChangeServer,
  onOpenDiagnostics,
}: {
  onOpenSession: (entityUrl: string) => void
  onNewSession: () => void
  onChangeServer: () => void
  onOpenDiagnostics: () => void
}): React.ReactElement {
  const { entitiesCollection, serverUrl } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const prefs = useSidebarPrefs()

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState(``)
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: entities = [] } = useLiveQuery(
    (q) =>
      q
        .from({ entity: entitiesCollection })
        .orderBy(({ entity }) => entity.updated_at, `desc`),
    [entitiesCollection]
  )

  // Filter pipeline: hidden types/statuses → search query → grouping.
  const filteredEntities = useMemo(() => {
    const hidesAnything =
      prefs.hiddenTypes.size > 0 || prefs.hiddenStatuses.size > 0
    const trimmed = query.trim().toLowerCase()
    if (!hidesAnything && !trimmed) return entities
    return entities.filter((entity) => {
      if (prefs.hiddenTypes.has(entity.type)) return false
      if (prefs.hiddenStatuses.has(entity.status)) return false
      if (!trimmed) return true
      const title = getEntityDisplayTitle(entity).toLowerCase()
      return title.includes(trimmed)
    })
  }, [entities, prefs.hiddenTypes, prefs.hiddenStatuses, query])

  // Search overrides grouping — a flat hit list reads better than
  // pretending the matches still belong to time buckets.
  const groups: Array<SessionGroup> = useMemo(() => {
    if (query.trim()) {
      // Search overrides bucketing: a flat hit list reads better
      // than pretending matches still belong to time buckets. We
      // reuse the `older` key purely so this conforms to
      // `SessionGroup` — the row renderer only consumes `label`.
      return [
        {
          id: `results`,
          key: `older` as const,
          label: `Results`,
          items: [...filteredEntities],
        },
      ]
    }
    switch (prefs.groupBy) {
      case `type`:
        return groupByType(filteredEntities)
      case `status`:
        return groupByStatus(filteredEntities)
      case `date`:
      default:
        return bucketEntities(filteredEntities)
    }
  }, [filteredEntities, prefs.groupBy, query])

  // Same connectivity ping the old footer used — feeds the green/red
  // dot in the home menu.
  const [serverStatus, setServerStatus] = useState<ServerHealth>(`unset`)
  const probeId = useRef(0)
  const [refreshing, setRefreshing] = useState(false)

  const probeOnce = useCallback(
    async (signal: { cancelled: boolean }): Promise<void> => {
      try {
        await checkServerHealth(serverUrl)
        if (!signal.cancelled) setServerStatus(`ok`)
      } catch {
        if (!signal.cancelled) setServerStatus(`down`)
      }
    },
    [serverUrl]
  )

  useEffect(() => {
    const signal = { cancelled: false }
    setServerStatus(`unset`)
    void probeOnce(signal)
    const interval = setInterval(() => void probeOnce(signal), 10_000)
    return () => {
      signal.cancelled = true
      clearInterval(interval)
    }
  }, [serverUrl, probeOnce])

  const onRefresh = useCallback(async () => {
    const id = ++probeId.current
    setRefreshing(true)
    const start = Date.now()
    await probeOnce({ cancelled: false })
    const elapsed = Date.now() - start
    if (elapsed < 600) {
      await new Promise<void>((r) => setTimeout(r, 600 - elapsed))
    }
    if (probeId.current === id) setRefreshing(false)
  }, [probeOnce])

  const closeSearch = (): void => {
    setSearchOpen(false)
    setQuery(``)
  }

  return (
    <Screen>
      {searchOpen ? (
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onCancel={closeSearch}
        />
      ) : (
        <Header
          title="Electric Agents"
          actions={
            <>
              <TopBarIconButton
                icon="search"
                onPress={() => setSearchOpen(true)}
                accessibilityLabel="Search sessions"
              />
              <TopBarIconButton
                icon="more"
                onPress={() => setMenuOpen(true)}
                accessibilityLabel="More options"
              />
            </>
          }
        />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.accent11}
            colors={[tokens.accent11]}
            progressBackgroundColor={tokens.surface}
          />
        }
      >
        {groups.map((group, idx) => (
          <View
            key={group.id}
            style={[styles.section, idx === 0 ? styles.sectionFirst : null]}
          >
            <Text style={styles.sectionLabel}>{group.label}</Text>
            {group.items.map((entity) => (
              <SessionRow
                key={entity.url}
                entity={entity}
                onPress={() => onOpenSession(entity.url)}
              />
            ))}
          </View>
        ))}

        {entities.length === 0 && (
          <EmptyState
            title="No sessions yet"
            body={`Tap "New" to start your first session.`}
          />
        )}
        {entities.length > 0 && filteredEntities.length === 0 && (
          <EmptyState
            title={query.trim() ? `No matches` : `No sessions match`}
            body={
              query.trim()
                ? `Try a different search.`
                : `Adjust the filters in the more menu.`
            }
          />
        )}
      </ScrollView>

      {!searchOpen && (
        <Fab
          icon="pencil"
          label="New"
          onPress={onNewSession}
          accessibilityLabel="New session"
        />
      )}

      <HomeMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        serverHealth={serverStatus}
        onChangeServer={onChangeServer}
        onOpenDiagnostics={onOpenDiagnostics}
      />
    </Screen>
  )
}

function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <View style={{ paddingTop: 64, paddingHorizontal: 24, gap: 6 }}>
      <Text
        style={{
          textAlign: `center`,
          color: tokens.text2,
          fontSize: fontSize.lg,
          fontWeight: `500`,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          textAlign: `center`,
          color: tokens.text3,
          fontSize: fontSize.base,
        }}
      >
        {body}
      </Text>
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 8,
      // Reserve room at the bottom so the FAB never covers the last
      // row. 96 ≈ FAB height (48) + bottom inset margin (16) + gap.
      paddingBottom: 96,
    },
    section: {
      marginTop: spacing.md,
    },
    sectionFirst: {
      marginTop: spacing.sm,
    },
    sectionLabel: {
      paddingTop: 8,
      paddingHorizontal: 12,
      paddingBottom: 6,
      color: tokens.text3,
      fontSize: 12,
      fontWeight: `600`,
      letterSpacing: 0.2,
      textTransform: `uppercase`,
    },
  })
}
