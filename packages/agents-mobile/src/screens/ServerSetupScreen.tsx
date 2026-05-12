import { useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, rowHeight, spacing } from '../lib/theme'
import { checkServerHealth, normalizeServerUrl } from '../lib/agentsClient'
import type { MobileServerConfig } from '../lib/MobileAppState'
import type { Tokens } from '../lib/theme'

export function ServerSetupScreen({
  initialUrl,
  servers,
  activeUrl,
  onCancel,
  onSave,
  onSelectServer,
  onRemoveServer,
}: {
  initialUrl?: string
  servers?: Array<MobileServerConfig>
  activeUrl?: string | null
  onCancel?: () => void
  onSave: (serverUrl: string) => Promise<void>
  onSelectServer?: (serverUrl: string) => Promise<void>
  onRemoveServer?: (serverUrl: string) => Promise<void>
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [value, setValue] = useState(initialUrl ?? ``)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      setError(`Enter an agents server URL.`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      await checkServerHealth(normalized)
      await onSave(normalized)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === `ios` ? `padding` : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>Electric Agents</Text>
            <Text style={styles.title}>Edit servers</Text>
            <Text style={styles.copy}>
              Mobile connects to a running server. It does not bundle a local
              Horton runtime.
            </Text>
          </View>

          {servers && servers.length > 0 ? (
            <View style={styles.savedSection}>
              <Text style={styles.label}>Saved servers</Text>
              {servers.map((server) => {
                const active = server.url === activeUrl
                return (
                  <View key={server.url} style={styles.serverRow}>
                    <Pressable
                      onPress={() => {
                        if (!active) void onSelectServer?.(server.url)
                      }}
                      style={({ pressed }) => [
                        styles.serverMain,
                        active ? styles.serverActive : null,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Text style={styles.serverName} numberOfLines={1}>
                        {server.name}
                      </Text>
                      <Text style={styles.serverUrl} numberOfLines={1}>
                        {server.url}
                      </Text>
                    </Pressable>
                    <PrimaryButton
                      title="Remove"
                      variant="ghost"
                      onPress={() => void onRemoveServer?.(server.url)}
                      disabled={loading}
                    />
                  </View>
                )
              })}
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Add server URL</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://agents.example.com"
              placeholderTextColor={tokens.text3}
              value={value}
              onChangeText={setValue}
              onSubmitEditing={submit}
              returnKeyType="go"
              style={styles.input}
            />
          </View>

          {error && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.actions}>
            {onCancel && (
              <PrimaryButton
                title="Cancel"
                variant="ghost"
                onPress={onCancel}
                disabled={loading}
              />
            )}
            <PrimaryButton
              title="Add server"
              loading={loading}
              onPress={submit}
              disabled={loading}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: `center`,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxxl,
      gap: spacing.lg,
    },
    heading: {
      alignItems: `flex-start`,
      gap: spacing.sm,
      paddingBottom: spacing.md,
    },
    eyebrow: {
      color: tokens.text3,
      fontSize: fontSize.sm,
    },
    title: {
      color: tokens.text1,
      fontSize: fontSize.xxxl,
      fontWeight: `400`,
      lineHeight: lineHeight.xxxl,
    },
    copy: {
      color: tokens.text2,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
    },
    field: {
      gap: spacing.xs,
    },
    label: {
      color: tokens.text2,
      fontSize: fontSize.sm,
    },
    input: {
      minHeight: rowHeight.lg,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.sm,
      backgroundColor: tokens.inputBg,
      color: tokens.text1,
      fontSize: fontSize.base,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    savedSection: {
      gap: spacing.sm,
    },
    serverRow: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
    },
    serverMain: {
      flex: 1,
      minWidth: 0,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    serverActive: {
      borderColor: tokens.accent9,
      backgroundColor: tokens.accentA2,
    },
    pressed: {
      opacity: 0.85,
    },
    serverName: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    serverUrl: {
      marginTop: 2,
      color: tokens.text3,
      fontSize: fontSize.xs,
    },
    errorRow: {
      borderRadius: radii.sm,
      backgroundColor: tokens.redA2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    errorText: {
      color: tokens.red11,
      fontSize: fontSize.sm,
    },
    actions: {
      flexDirection: `row`,
      gap: spacing.sm,
      justifyContent: `flex-end`,
      paddingTop: spacing.sm,
    },
  })
}
