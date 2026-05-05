import { useMemo } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { Badge, type BadgeTone } from '../components/Badge'
import { Header, HeaderBackButton } from '../components/Header'
import { IconToggle } from '../components/IconToggle'
import { Screen } from '../components/Screen'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle, type ElectricEntity } from '../lib/agentsClient'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import type { EmbedViewId } from '../webview/embedSource'

const STATUS_TONE: Record<string, BadgeTone> = {
  running: `info`,
  idle: `success`,
  spawning: `warning`,
  stopped: `neutral`,
}

/**
 * Native chrome for an active session.
 *
 * The session body itself (chat / state-explorer) is rendered by the
 * app-level `<PersistentEmbed>` so the WebView's JS context survives
 * navigation back to the list. This screen contributes:
 *
 *   - the safe-area top inset
 *   - the `<Header>` strip (back button, title, status badge, view
 *     toggle)
 *   - a `KeyboardAvoidingView` that resizes the WebView body when the
 *     iOS keyboard appears
 *
 * `onSetView` lifts the local view state up to `App.tsx`, so toggling
 * the chat / state-explorer affordance re-routes through
 * `<PersistentEmbed>` (which posts `set-view` to the embed) instead of
 * keying the WebView.
 */
export function SessionScreen({
  entityUrl,
  view,
  onBack,
  onSetView,
}: {
  entityUrl: string
  view: EmbedViewId
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
}): React.ReactElement {
  const { entitiesCollection } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  const { data: matches = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .where(({ entity }) => eq(entity.url, entityUrl)),
    [entitiesCollection, entityUrl]
  )
  const entity = matches.at(0) ?? null

  return (
    <Screen>
      {/*
        Mirrors `<EntityHeader>` which composes `<MainHeader>`:
        44px row, page bg, no border. Title block on the left
        (entity title + sessionId mono subtitle), actions cluster
        on the right (status badge + view-toggle icons).
      */}
      <Header
        leading={<HeaderBackButton onPress={onBack} label="Sessions" />}
        title={<EntityTitle entity={entity} entityUrl={entityUrl} />}
        actions={
          <View style={styles.actions}>
            {entity && (
              <Badge tone={STATUS_TONE[entity.status] ?? `neutral`}>
                {entity.status}
              </Badge>
            )}
            <IconToggle
              active={view === `chat`}
              onPress={() => onSetView(`chat`)}
              accessibilityLabel="Chat"
            >
              <Glyph color={view === `chat` ? tokens.text1 : tokens.text2}>
                ◧
              </Glyph>
            </IconToggle>
            <IconToggle
              active={view === `state-explorer`}
              onPress={() => onSetView(`state-explorer`)}
              accessibilityLabel="State explorer"
            >
              <Glyph
                color={view === `state-explorer` ? tokens.text1 : tokens.text2}
              >
                ⛁
              </Glyph>
            </IconToggle>
          </View>
        }
      />

      {/*
        Empty body — the actual WebView lives in `<PersistentEmbed>`,
        absolutely positioned at `top = safe-area-top + 44px`. The
        KeyboardAvoidingView shares its insets with the WebView host so
        the embed composer follows the keyboard on iOS.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === `ios` ? `padding` : undefined}
        style={styles.body}
      >
        <View style={styles.bodyFill} />
      </KeyboardAvoidingView>
    </Screen>
  )
}

/**
 * Standalone "loading" placeholder shown by App.tsx **before** the
 * persistent WebView has booted. Matches the look of `SessionScreen`
 * (header + empty body) so the transition is invisible to the user.
 */
function EntityTitle({
  entity,
  entityUrl,
}: {
  entity: ElectricEntity | null
  entityUrl: string
}): React.ReactElement {
  const tokens = useTokens()
  const sessionId = entityUrl.replace(/^\//, ``)
  const title = entity
    ? getEntityDisplayTitle(entity)
    : decodeURIComponent(sessionId)

  return (
    <View
      style={{
        flexDirection: `row`,
        alignItems: `baseline`,
        gap: spacing.sm,
        minWidth: 0,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: tokens.text1,
          fontSize: fontSize.base,
          fontWeight: `500`,
        }}
      >
        {title}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: tokens.text3,
          fontSize: fontSize.sm,
          fontFamily: Platform.OS === `ios` ? `Menlo` : `monospace`,
        }}
      >
        {sessionId}
      </Text>
    </View>
  )
}

function Glyph({
  children,
  color,
}: {
  children: string
  color: string
}): React.ReactElement {
  return <Text style={{ color, fontSize: 14, lineHeight: 16 }}>{children}</Text>
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    actions: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 2,
    },
    body: {
      flex: 1,
    },
    bodyFill: {
      flex: 1,
      backgroundColor: tokens.bg,
    },
  })
}
