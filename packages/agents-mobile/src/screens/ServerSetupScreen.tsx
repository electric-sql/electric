import { useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { CloudServerPicker } from '../components/CloudServerPicker'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useCloudAuth } from '../lib/CloudAuthContext'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, rowHeight, spacing } from '../lib/theme'
import { checkServerHealth, normalizeServerUrl } from '../lib/agentsClient'
import { prepareServerHeaders } from '../lib/serverHeaders'
import type { Tokens } from '../lib/theme'

export function ServerSetupScreen({
  initialUrl,
  onCancel,
  onSave,
}: {
  initialUrl?: string
  onCancel?: () => void
  onSave: (serverUrl: string) => Promise<void>
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { state: cloudState, signIn, signOut } = useCloudAuth()
  const [value, setValue] = useState(initialUrl ?? ``)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSignedInToCloud = cloudState.status === `signed-in`
  const isSigningInToCloud = cloudState.status === `signing-in`

  const submit = async () => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      setError(`Enter an agents server URL.`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Inject Cloud auth headers (if applicable) before the health
      // check probes the server — Cloud agent servers reject
      // unauthenticated requests with 401.
      await prepareServerHeaders(normalized)
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
            <Text style={styles.title}>Connect to an agents server</Text>
            <Text style={styles.copy}>
              Mobile connects to a running server. It does not bundle a local
              Horton runtime.
            </Text>
            {isSignedInToCloud ? (
              <Text style={styles.hint}>
                Signed in to Electric Cloud as{' '}
                {cloudState.email ?? `this account`}. Want to try a different
                Google account? Sign out below, then sign in again.
              </Text>
            ) : (
              <Text style={styles.hint}>
                Not signed in to Electric Cloud. Sign in below to discover your
                cloud-hosted agent servers automatically.
              </Text>
            )}
          </View>

          <CloudServerPicker
            onPick={(picked) => setValue(picked)}
            disabled={loading}
          />

          <View style={styles.field}>
            <Text style={styles.label}>Server URL</Text>
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
                disabled={loading || isSigningInToCloud}
              />
            )}
            {isSignedInToCloud ? (
              <PrimaryButton
                title="Sign out"
                variant="ghost"
                onPress={() => {
                  void signOut()
                }}
                disabled={loading || isSigningInToCloud}
              />
            ) : (
              <>
                <PrimaryButton
                  title={
                    isSigningInToCloud
                      ? `Opening browser…`
                      : `Sign in with GitHub`
                  }
                  variant="ghost"
                  onPress={() => {
                    void signIn(`github`)
                  }}
                  disabled={loading || isSigningInToCloud}
                />
                <PrimaryButton
                  title={
                    isSigningInToCloud
                      ? `Opening browser…`
                      : `Sign in with Google`
                  }
                  variant="ghost"
                  onPress={() => {
                    void signIn(`google`)
                  }}
                  disabled={loading || isSigningInToCloud}
                />
              </>
            )}
            <PrimaryButton
              title="Connect"
              loading={loading}
              onPress={submit}
              disabled={loading || isSigningInToCloud}
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
    hint: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
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
