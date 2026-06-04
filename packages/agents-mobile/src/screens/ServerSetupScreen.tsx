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
import { Header, HeaderBackButton } from '../components/Header'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useCloudAuth } from '../lib/CloudAuthContext'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, rowHeight, spacing } from '../lib/theme'
import { checkServerHealth, normalizeServerUrl } from '../lib/agentsClient'
import { prepareServerHeaders } from '../lib/serverHeaders'
import { getCloudServiceIdFromServerUrl } from '../lib/cloudAgentUrls'
import { addSavedServer } from '../lib/savedServers'
import type { Tokens } from '../lib/theme'

/**
 * Standalone "select or add an agents server" screen, reached from the
 * Home menu (with `onCancel`) or as the `!serverUrl` fallback from the
 * root layout. Mirrors the onboarding step-2 anatomy.
 */
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
  const { state: cloudState, signIn } = useCloudAuth()
  const [customUrlOpen, setCustomUrlOpen] = useState(false)
  const [customUrlValue, setCustomUrlValue] = useState(initialUrl ?? ``)
  const [submitting, setSubmitting] = useState(false)
  const [cloudConnectError, setCloudConnectError] = useState<string | null>(
    null
  )
  const [customUrlError, setCustomUrlError] = useState<string | null>(null)

  const isCloudSignedIn = cloudState.status === `signed-in`
  const isSigningInToCloud = cloudState.status === `signing-in`

  const commit = async (
    url: string,
    displayName?: string
  ): Promise<string | null> => {
    setSubmitting(true)
    try {
      // Cloud agent servers reject unauthenticated requests with 401,
      // so headers must be registered before the health probe.
      await prepareServerHeaders(url)
      await checkServerHealth(url)
      // Remember the server so it appears in the unified picker and
      // survives a relaunch. Cloud servers are tagged so they can be
      // purged on sign-out.
      const serviceId = getCloudServiceIdFromServerUrl(url)
      const name = displayName ?? hostOf(url)
      addSavedServer(
        serviceId
          ? { id: serviceId, name, url, source: `electric-cloud` }
          : { id: url, name, url, source: `manual` }
      )
      await onSave(url)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      setSubmitting(false)
    }
  }

  const connectCloudRow = async (url: string, name: string): Promise<void> => {
    setCloudConnectError(null)
    const err = await commit(url, name)
    if (err) setCloudConnectError(err)
  }

  const submitCustom = async (): Promise<void> => {
    const normalized = normalizeServerUrl(customUrlValue)
    if (!normalized) {
      setCustomUrlError(`Enter an agents server URL.`)
      return
    }
    setCustomUrlError(null)
    const err = await commit(normalized)
    if (err) setCustomUrlError(err)
  }

  const toggleCustomUrl = (): void => {
    setCustomUrlError(null)
    setCustomUrlOpen((open) => !open)
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === `ios` ? `padding` : undefined}
        style={styles.flex}
      >
        {onCancel && (
          <Header
            align="center"
            title="Server"
            leading={<HeaderBackButton onPress={onCancel} />}
          />
        )}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {!onCancel && <Text style={styles.title}>Server</Text>}
          <Text style={styles.description}>
            Choose or add the agents server this app connects to.
          </Text>

          {!isCloudSignedIn && (
            <View style={styles.cloudSignIn}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeaderText}>
                  <Text style={styles.sectionHeaderTitle}>Electric Cloud</Text>
                  <Text style={styles.sectionHeaderDescription}>
                    Sign in to discover hosted agents servers.
                  </Text>
                </View>
              </View>
              <PrimaryButton
                title={
                  isSigningInToCloud
                    ? `Opening browser…`
                    : `Sign in with GitHub`
                }
                leadingIcon="github"
                disabled={isSigningInToCloud || submitting}
                onPress={() => {
                  void signIn(`github`)
                }}
              />
              <PrimaryButton
                title={
                  isSigningInToCloud
                    ? `Opening browser…`
                    : `Sign in with Google`
                }
                variant="soft"
                leadingIcon="google"
                disabled={isSigningInToCloud || submitting}
                onPress={() => {
                  void signIn(`google`)
                }}
              />
            </View>
          )}

          <CloudServerPicker
            onConnect={(url, server) => connectCloudRow(url, server.name)}
            disabled={submitting}
          />

          {cloudConnectError && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{cloudConnectError}</Text>
            </View>
          )}

          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.sectionHeaderTitle}>Custom server</Text>
              <Text style={styles.sectionHeaderDescription}>
                Connect to a self-hosted agents server.
              </Text>
            </View>
            <View style={styles.sectionHeaderAction}>
              <PrimaryButton
                title={customUrlOpen ? `Cancel` : `Add custom URL`}
                variant="ghost"
                onPress={toggleCustomUrl}
                disabled={submitting}
              />
            </View>
          </View>

          {customUrlOpen && (
            <View style={styles.customUrlPanel}>
              <View style={styles.field}>
                <Text style={styles.label}>Server URL</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://agents.example.com"
                  placeholderTextColor={tokens.text3}
                  value={customUrlValue}
                  onChangeText={setCustomUrlValue}
                  onSubmitEditing={() => {
                    void submitCustom()
                  }}
                  returnKeyType="go"
                  style={styles.input}
                />
              </View>
              {customUrlError && (
                <View style={styles.errorRow}>
                  <Text style={styles.errorText}>{customUrlError}</Text>
                </View>
              )}
              <PrimaryButton
                title="Connect"
                loading={submitting}
                disabled={submitting}
                onPress={() => {
                  void submitCustom()
                }}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xxxl,
      gap: spacing.lg,
    },
    title: {
      color: tokens.text1,
      fontSize: fontSize.xxxl,
      fontWeight: `400`,
      lineHeight: lineHeight.xxxl,
    },
    description: {
      color: tokens.text2,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
    },
    cloudSignIn: {
      gap: spacing.md,
    },
    sectionHeader: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.md,
    },
    sectionHeaderText: {
      flex: 1,
      gap: 2,
    },
    sectionHeaderTitle: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    sectionHeaderDescription: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    sectionHeaderAction: {
      flexShrink: 0,
    },
    customUrlPanel: {
      gap: spacing.sm,
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
  })
}
