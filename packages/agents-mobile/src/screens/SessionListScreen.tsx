import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import { Header } from '../components/Header'
import { Screen } from '../components/Screen'
import { NewSessionRow, SidebarRow } from '../components/SidebarRow'
import { SidebarFooter } from '../components/sidebar/SidebarFooter'
import type { ServerStatus } from '../components/sidebar/ServerPickerTile'
import { useAgents } from '../lib/AgentsProvider'
import { checkServerHealth } from '../lib/agentsClient'
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

  const { data: entities = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .orderBy(({ entity }) => entity.updated_at, `desc`),
    [entitiesCollection]
  )

  // Apply Show > Type / Show > Status filters before bucketing so a
  // hidden parent doesn't reparent its children to the root level —
  // matches the web sidebar behaviour.
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

  const groups: Array<SessionGroup> = useMemo(() => {
    switch (prefs.groupBy) {
      case `type`:
        return groupByType(visibleEntities)
      case `status`:
        return groupByStatus(visibleEntities)
      case `date`:
      default:
        return bucketEntities(visibleEntities)
    }
  }, [visibleEntities, prefs.groupBy])

  // Cheap connectivity probe so the footer's status dot reads
  // green/red instead of the unset grey. Mirrors the web sidebar's
  // ServerPicker dot which lights up from the same `/health` ping.
  const [serverStatus, setServerStatus] = useState<ServerStatus>(`unset`)
  // Bumped by the user's pull-to-refresh gesture so we can run the
  // probe outside the polling cadence too.
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

  // Pull-to-refresh: the live query is already up-to-date, so this is
  // really a "is the server still reachable?" gesture + a quick visual
  // beat so the user gets feedback. We run the same probe the polling
  // tick does and hold the spinner for ~600 ms minimum so the gesture
  // doesn't snap back instantly on a fast network.
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

  return (
    <Screen>
      {/*
        Top strip mirrors `<MainHeader>` — 44px, page bg, no border.
        Title is plain "Sessions"; the footer below carries the
        server picker, filter and settings affordances exactly as on
        the web sidebar.
      */}
      <Header title="Sessions" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            // Tint the spinner with the accent so it reads as part of
            // the brand. iOS only — Android uses `colors=[…]`.
            tintColor={tokens.accent11}
            colors={[tokens.accent11]}
            progressBackgroundColor={tokens.surface}
          />
        }
      >
        <NewSessionRow onPress={onNewSession} />

        {groups.map((group) => (
          <View key={group.id} style={styles.section}>
            <Text style={styles.sectionLabel}>{group.label}</Text>
            {group.items.map((entity) => (
              <SidebarRow
                key={entity.url}
                entity={entity}
                selected={false}
                onPress={() => onOpenSession(entity.url)}
              />
            ))}
          </View>
        ))}

        {entities.length === 0 && (
          <Text style={styles.emptyText}>No sessions</Text>
        )}
        {entities.length > 0 && visibleEntities.length === 0 && (
          <Text style={styles.emptyText}>
            No sessions match the current filters
          </Text>
        )}
      </ScrollView>

      <SidebarFooter
        serverStatus={serverStatus}
        onChangeServer={onChangeServer}
        onOpenDiagnostics={onOpenDiagnostics}
      />
    </Screen>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 8,
      paddingBottom: spacing.lg,
    },
    section: {
      marginTop: 6,
    },
    sectionLabel: {
      // Mirrors `Sidebar.module.css .sectionLabel`: 11px / 500 / muted,
      // padding 14px 4px 4px 8px so it aligns with the icon column.
      paddingTop: 14,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 8,
      color: tokens.text3,
      fontSize: 11,
      fontWeight: `500`,
    },
    emptyText: {
      paddingTop: 20,
      textAlign: `center`,
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
  })
}
