import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { Header, HeaderBackButton } from '../components/Header'
import { Screen } from '../components/Screen'
import { SessionMenu } from '../components/SessionMenu'
import { TopBarIconButton } from '../components/TopBarIconButton'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle } from '../lib/agentsClient'
import { useTokens } from '../lib/ThemeProvider'
import type { Tokens } from '../lib/theme'
import type { EmbedViewId } from '../webview/embedSource'

/**
 * Native chrome for an active session — the chat WebView itself
 * lives in `<PersistentEmbed>` (mounted once at the app root). This
 * screen contributes the safe-area top inset, an iOS-style
 * `<Header>` (back chevron, centered title, kebab), and a
 * `KeyboardAvoidingView` that resizes the embed body when the
 * keyboard appears.
 *
 * View toggling (chat ↔ state explorer) used to live in the toolbar
 * as `<IconToggle>`s; we moved it into the kebab `<SessionMenu>` so
 * the toolbar matches a stock chat-app pattern (← title …).
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
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: matches = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .where(({ entity }) => eq(entity.url, entityUrl)),
    [entitiesCollection, entityUrl]
  )
  const entity = matches.at(0) ?? null

  const title = entity
    ? getEntityDisplayTitle(entity)
    : decodeURIComponent(entityUrl.replace(/^\//, ``))

  return (
    <Screen>
      <Header
        align="center"
        leading={<HeaderBackButton onPress={onBack} />}
        title={title}
        actions={
          <TopBarIconButton
            icon="more"
            onPress={() => setMenuOpen(true)}
            accessibilityLabel="Session options"
          />
        }
      />

      {/*
        Empty body — the actual chat / state-explorer surface lives
        in the app-level `<PersistentEmbed>`, absolutely positioned
        at `top = safe-area-top + 44px`. The KeyboardAvoidingView
        shares its insets with the embed so the composer follows the
        keyboard on iOS.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === `ios` ? `padding` : undefined}
        style={styles.body}
      >
        <View style={styles.bodyFill} />
      </KeyboardAvoidingView>

      <SessionMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        entity={entity}
        view={view}
        onSetView={onSetView}
      />
    </Screen>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    body: {
      flex: 1,
    },
    bodyFill: {
      flex: 1,
      backgroundColor: tokens.bg,
    },
  })
}
