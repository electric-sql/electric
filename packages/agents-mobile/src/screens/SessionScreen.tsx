import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { Header, HeaderBackButton } from '../components/Header'
import { Icon } from '../components/Icon'
import { Screen } from '../components/Screen'
import { SessionMenu } from '../components/SessionMenu'
import { TopBarIconButton } from '../components/TopBarIconButton'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle } from '../lib/agentsClient'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import type { EmbedViewId } from '../lib/embedView'

export const CHAT_COMPOSER_BASE_HEIGHT = 76
export const CHAT_COMPOSER_OVERLAP = 20

const COMPOSER_INPUT_MIN_HEIGHT = 40
const COMPOSER_INPUT_MAX_HEIGHT = 200
const COMPOSER_MIN_CARD_HEIGHT = 48

export function ChatSessionScreen({
  entityUrl,
  onBack,
  onSetView,
  onComposerHeightChange,
  onSendMessage,
}: {
  entityUrl: string
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
  onComposerHeightChange: (height: number) => void
  onSendMessage: () => void
}): React.ReactElement {
  return (
    <SessionScreen
      entityUrl={entityUrl}
      view="chat"
      onBack={onBack}
      onSetView={onSetView}
      onComposerHeightChange={onComposerHeightChange}
      onSendMessage={onSendMessage}
    />
  )
}

export function StateInspectorSessionScreen({
  entityUrl,
  onBack,
  onSetView,
}: {
  entityUrl: string
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
}): React.ReactElement {
  return (
    <SessionScreen
      entityUrl={entityUrl}
      view="state-explorer"
      onBack={onBack}
      onSetView={onSetView}
    />
  )
}

/**
 * Native chrome for an active session. This screen contributes the
 * safe-area top inset, an iOS-style `<Header>` (back chevron, centered
 * title, kebab), and a keyboard-anchored native composer.
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
  onComposerHeightChange,
  onSendMessage,
}: {
  entityUrl: string
  view: EmbedViewId
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
  onComposerHeightChange?: (height: number) => void
  onSendMessage?: () => void
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
    <Screen style={styles.screen} pointerEvents="box-none">
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

      <View pointerEvents="none" style={styles.bodyFill} />
      {view === `chat` && (
        <NativeMessageComposer
          entityUrl={entityUrl}
          onHeightChange={onComposerHeightChange}
          onSendMessage={onSendMessage}
          disabled={
            !entity ||
            entity.status === `stopped` ||
            entity.status === `spawning`
          }
          placeholder={
            entity?.status === `stopped`
              ? `Entity stopped`
              : entity?.status === `spawning`
                ? `Starting...`
                : `Send a message...`
          }
        />
      )}

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

function NativeMessageComposer({
  entityUrl,
  onHeightChange,
  onSendMessage,
  disabled,
  placeholder,
}: {
  entityUrl: string
  onHeightChange?: (height: number) => void
  onSendMessage?: () => void
  disabled: boolean
  placeholder: string
}): React.ReactElement {
  const { serverUrl } = useAgents()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createComposerStyles(tokens), [tokens])
  const { keyboardVisible, keyboardTranslateY } = useKeyboardAttachment()
  const [value, setValue] = useState(``)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputHeight, setInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT)
  const text = value.trim()
  const canSend = text.length > 0 && !disabled && !sending
  const bottomPadding = keyboardVisible ? 4 : Math.max(insets.bottom, 8)
  const setMeasuredInputHeight = (height: number): void => {
    const nextHeight = Math.min(
      COMPOSER_INPUT_MAX_HEIGHT,
      Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.ceil(height))
    )
    setInputHeight((current) => (current === nextHeight ? current : nextHeight))
  }

  const handleChangeText = (nextValue: string): void => {
    setValue(nextValue)

    // `onContentSizeChange` is the source of truth for wrapped lines, but
    // explicit newlines can be reflected immediately while RN catches up.
    const explicitLines = nextValue.split(/\r\n|\r|\n/).length
    if (explicitLines > 1) {
      setMeasuredInputHeight(explicitLines * lineHeight.lg + spacing.lg)
    }
  }

  useEffect(() => {
    const cardHeight = Math.max(
      COMPOSER_MIN_CARD_HEIGHT,
      inputHeight + spacing.sm * 2
    )
    const errorHeight = error ? lineHeight.xs + spacing.xs : 0
    onHeightChange?.(cardHeight + bottomPadding + errorHeight)
  }, [bottomPadding, error, inputHeight, onHeightChange])

  const send = async (): Promise<void> => {
    if (!canSend) return

    setSending(true)
    setError(null)
    setValue(``)

    try {
      const res = await fetch(`${serverUrl}${entityUrl}/send`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ from: `user`, payload: { text } }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        let message = `Send failed (${res.status})`
        if (body) {
          try {
            const data = JSON.parse(body) as Record<string, unknown>
            if (data.message) message = String(data.message)
          } catch {
            message = body
          }
        }
        throw new Error(message)
      }
      onSendMessage?.()
    } catch (err) {
      setValue(text)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Animated.View
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[
        styles.root,
        {
          paddingBottom: bottomPadding,
          transform: [{ translateY: keyboardTranslateY }],
        },
      ]}
    >
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={[styles.composer, disabled ? styles.disabled : null]}>
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          editable={!disabled && !sending}
          multiline
          placeholder={placeholder}
          placeholderTextColor={tokens.text4}
          scrollEnabled={inputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
          onContentSizeChange={(event) => {
            setMeasuredInputHeight(event.nativeEvent.contentSize.height)
          }}
          style={[styles.input, { height: inputHeight }]}
          returnKeyType="default"
        />
        <Pressable
          onPress={() => void send()}
          disabled={!canSend}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [
            styles.sendButton,
            canSend ? styles.sendButtonActive : null,
            pressed && canSend ? styles.sendButtonPressed : null,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={tokens.textOnAccent} />
          ) : (
            <Icon
              name="arrow-up"
              size={18}
              color={canSend ? tokens.textOnAccent : tokens.text4}
              strokeWidth={2.4}
            />
          )}
        </Pressable>
      </View>
    </Animated.View>
  )
}

function useKeyboardAttachment(): {
  keyboardVisible: boolean
  keyboardTranslateY: Animated.Value
} {
  const keyboardTranslateY = useRef(new Animated.Value(0)).current
  const [keyboardVisible, setKeyboardVisible] = useState(false)

  useEffect(() => {
    const animateTo = (event: KeyboardEvent, toValue: number): void => {
      Animated.timing(keyboardTranslateY, {
        toValue,
        duration: event.duration ?? 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    }

    const showOrChange = (event: KeyboardEvent): void => {
      setKeyboardVisible(true)
      animateTo(event, -event.endCoordinates.height)
    }
    const hide = (event: KeyboardEvent): void => {
      setKeyboardVisible(false)
      animateTo(event, 0)
    }

    const subscriptions = [
      Keyboard.addListener(`keyboardWillChangeFrame`, showOrChange),
      Keyboard.addListener(`keyboardWillHide`, hide),
      Keyboard.addListener(`keyboardDidShow`, showOrChange),
      Keyboard.addListener(`keyboardDidHide`, hide),
    ]

    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [keyboardTranslateY])

  return { keyboardVisible, keyboardTranslateY }
}

function createStyles(_tokens: Tokens) {
  return StyleSheet.create({
    body: {
      flex: 1,
    },
    screen: {
      backgroundColor: `transparent`,
    },
    bodyFill: {
      flex: 1,
      backgroundColor: `transparent`,
    },
  })
}

function createComposerStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      position: `absolute`,
      left: 0,
      right: 0,
      bottom: 0,
      marginTop: -CHAT_COMPOSER_OVERLAP,
      paddingHorizontal: spacing.lg,
      paddingTop: 0,
      backgroundColor: tokens.bg,
      zIndex: 10,
    },
    composer: {
      minHeight: 48,
      flexDirection: `row`,
      alignItems: `flex-end`,
      gap: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.xl,
      backgroundColor: tokens.surfaceRaised,
      shadowColor: `#000`,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: tokens.scheme === `dark` ? 0.35 : 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    disabled: {
      opacity: 0.65,
    },
    input: {
      flex: 1,
      minWidth: 0,
      maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
      minHeight: COMPOSER_INPUT_MIN_HEIGHT,
      paddingVertical: 0,
      color: tokens.text1,
      fontSize: fontSize.lg,
      lineHeight: lineHeight.lg,
      textAlignVertical: `top`,
    },
    sendButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.accentA3,
    },
    sendButtonActive: {
      backgroundColor: tokens.accent9,
    },
    sendButtonPressed: {
      opacity: 0.8,
    },
    error: {
      marginBottom: spacing.xs,
      color: tokens.red11,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
  })
}
