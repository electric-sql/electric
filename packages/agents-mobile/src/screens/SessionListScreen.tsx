import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { eq, not, useLiveQuery } from '@tanstack/react-db'
import { Fab } from '../components/Fab'
import { Header } from '../components/Header'
import { HomeMenu, type ServerHealth } from '../components/HomeMenu'
import { Screen } from '../components/Screen'
import { SearchBar } from '../components/SearchBar'
import { SessionRow } from '../components/SessionRow'
import { buildEntityTree, SessionTree } from '../components/SessionTree'
import { TopBarIconButton } from '../components/TopBarIconButton'
import { useAgents } from '../lib/AgentsProvider'
import {
  checkServerHealth,
  getEntityDisplayTitle,
  type ElectricEntity,
} from '../lib/agentsClient'
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
 * Home screen — ChatGPT-mobile-style entry point with web-sidebar
 * tree parity. Layout:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Electric Agents          🔍  ⋯               │
 *   ├──────────────────────────────────────────────┤
 *   │ TODAY                                        │
 *   │   ● horton-1                       horton ›  │
 *   │   ● horton-2                       horton ›  │
 *   │ YESTERDAY                                    │
 *   │   ● parent-agent                horton +2 ⌄  │
 *   │     │── ● child-1                   worker   │
 *   │     └── ● child-2                   worker   │
 *   │                            [✎ New]           │
 *   └──────────────────────────────────────────────┘
 *
 * Search slides in inline (replacing the header) with title-based
 * filtering — matches render as a flat list (no tree, no grouping)
 * since that reads better than pretending matches still belong to
 * time buckets or to a particular subtree.
 */
export function SessionListScreen({
  onOpenSession,
  onNewSession,
  onChangeServer,
  onOpenDiagnostics,
  onOpenAccount,
}: {
  onOpenSession: (entityUrl: string) => void
  onNewSession: () => void
  onChangeServer: () => void
  onOpenDiagnostics: () => void
  onOpenAccount: () => void
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
        .where(({ entity }) => not(eq(entity.type, `principal`)))
        .orderBy(({ entity }) => entity.updated_at, `desc`),
    [entitiesCollection]
  )

  // Apply Show > Type / Show > Status filters before the tree build
  // so a hidden parent doesn't take its (visible) children with it —
  // children of a hidden parent reparent to the root level instead,
  // matching the web sidebar's filtering convention.
  const visibleEntities = useMemo(() => {
    if (prefs.hiddenTypes.size === 0 && prefs.hiddenStatuses.size === 0) {
      return entities
    }
    return entities.filter(
      (entity) =>
        !prefs.hiddenTypes.has(entity.type) &&
        !prefs.hiddenStatuses.has(entity.status)
    )
  }, [entities, prefs.hiddenTypes, prefs.hiddenStatuses])

  // Build the parent → children map once per filtered set; the
  // grouping below operates on the resulting roots only so a child
  // expanded under a parent doesn't also appear at the top level.
  const { roots, childrenByParent } = useMemo(
    () => buildEntityTree(visibleEntities),
    [visibleEntities]
  )

  // Search overrides bucketing AND tree structure: a flat hit list
  // matches every visible entity (any depth) whose title contains
  // the query. Filters and group-by are still applied because they
  // determine the candidate `visibleEntities` set above.
  const trimmedQuery = query.trim().toLowerCase()
  const searchResults = useMemo<Array<ElectricEntity>>(() => {
    if (!trimmedQuery) return []
    return visibleEntities.filter((entity) =>
      getEntityDisplayTitle(entity).toLowerCase().includes(trimmedQuery)
    )
  }, [visibleEntities, trimmedQuery])

  const groups: Array<SessionGroup> = useMemo(() => {
    if (trimmedQuery) {
      return [
        {
          id: `results`,
          key: `older` as const,
          label: `Results`,
          items: searchResults,
        },
      ]
    }
    switch (prefs.groupBy) {
      case `type`:
        return groupByType(roots)
      case `status`:
        return groupByStatus(roots)
      case `date`:
      default:
        return bucketEntities(roots)
    }
  }, [roots, prefs.groupBy, trimmedQuery, searchResults])

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
            {trimmedQuery
              ? // Flat list when searching — no expand chevrons, no
                // tree connectors, no child-count chips. The user is
                // looking for a specific session by name.
                group.items.map((entity) => (
                  <SessionRow
                    key={entity.url}
                    entity={entity}
                    depth={0}
                    onPress={() => onOpenSession(entity.url)}
                  />
                ))
              : // Default mode — every group item is a tree root. The
                // tree component reads expansion state per-url from
                // `expandedTree` and recursively renders children.
                group.items.map((root) => (
                  <SessionTree
                    key={root.url}
                    entity={root}
                    childrenByParent={childrenByParent}
                    onSelectEntity={onOpenSession}
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
        {entities.length > 0 && visibleEntities.length === 0 && (
          <EmptyState
            title="No sessions match"
            body="Adjust the filters in the more menu."
          />
        )}
        {entities.length > 0 &&
          visibleEntities.length > 0 &&
          trimmedQuery &&
          searchResults.length === 0 && (
            <EmptyState title="No matches" body="Try a different search." />
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
        onOpenAccount={onOpenAccount}
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
