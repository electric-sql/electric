import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
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
}: {
  onOpenSession: (entityUrl: string) => void
  onNewSession: () => void
  onChangeServer: () => void
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
  useEffect(() => {
    let cancelled = false
    setServerStatus(`unset`)

    const tick = async () => {
      try {
        await checkServerHealth(serverUrl)
        if (!cancelled) setServerStatus(`ok`)
      } catch {
        if (!cancelled) setServerStatus(`down`)
      }
    }

    void tick()
    const interval = setInterval(tick, 10_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [serverUrl])

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
