import { useMemo } from 'react'
import * as Linking from 'expo-linking'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Icon } from '../components/Icon'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useTokens } from '../lib/ThemeProvider'
import { useCloudAuth } from '../lib/CloudAuthContext'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

const DELETE_ACCOUNT_URL = `https://electric-sql.com/about/legal/delete-account`

/**
 * Settings → Account screen. Mirrors the desktop's `AccountPage` —
 * shows the GitHub/Google sign-in buttons when signed out, and the
 * user's name + workspaces + dashboard link when signed in.
 *
 * The OAuth flow runs in an in-system browser sheet via
 * `expo-web-browser.openAuthSessionAsync` (kicked off by `signIn` on
 * the cloud-auth context); this screen just observes state and pushes
 * verbs.
 */
export function AccountScreen({
  onBack,
}: {
  onBack: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const auth = useCloudAuth()
  const { state, signIn, signOut, openDashboard } = auth
  const isBusy = state.status === `signing-in`
  const isSignedIn = state.status === `signed-in`
  const workspaces = state.workspaces ?? null

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={spacing.md}
          style={({ pressed }) => [
            styles.headerButton,
            pressed ? styles.headerButtonPressed : null,
          ]}
        >
          <Icon name="back" size={20} color={tokens.text1} strokeWidth={2} />
        </Pressable>
        <Text style={styles.headerTitle}>Account</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Electric Cloud</Text>
          <Text style={styles.sectionCopy}>
            {isSignedIn
              ? `Signed in. Your local Electric Agents runtime can authenticate against Electric Cloud as this user.`
              : `Sign in with the same provider you use on the Electric Cloud dashboard. Your session is stored on this device.`}
          </Text>
        </View>

        {isSignedIn ? (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Account</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.rowValueText} numberOfLines={2}>
                    {state.name && state.email
                      ? `${state.name} (${state.email})`
                      : (state.name ?? state.email ?? `Signed in`)}
                  </Text>
                  {state.userId ? (
                    <Text style={styles.principalText} numberOfLines={1}>
                      user:{state.userId}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Workspaces</Text>
                <View style={styles.rowValue}>
                  {workspaces === null ? (
                    <Text style={[styles.rowValueText, styles.rowValueMuted]}>
                      Loading…
                    </Text>
                  ) : workspaces.length === 0 ? (
                    <Text style={[styles.rowValueText, styles.rowValueMuted]}>
                      No workspaces yet
                    </Text>
                  ) : (
                    workspaces.map((w) => (
                      <Text
                        key={w.id}
                        style={styles.rowValueText}
                        numberOfLines={1}
                      >
                        {w.name}
                      </Text>
                    ))
                  )}
                </View>
              </View>
              <View style={styles.actions}>
                <PrimaryButton
                  title="Open Electric Cloud dashboard"
                  onPress={() => {
                    void openDashboard()
                  }}
                />
                <PrimaryButton
                  title="Sign out"
                  variant="soft"
                  onPress={() => {
                    void signOut()
                  }}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Delete account</Text>
              <Text style={styles.sectionCopy}>
                Tap below to open the account-deletion page in your browser.
                Your account is not deleted by tapping the button — the page
                explains what gets deleted, what we may retain, and how to email
                support to start the request.
              </Text>
            </View>
            <View style={styles.card}>
              <View style={styles.actions}>
                <PrimaryButton
                  title="Delete account…"
                  variant="ghost"
                  onPress={() => {
                    void Linking.openURL(DELETE_ACCOUNT_URL)
                  }}
                />
              </View>
            </View>
          </>
        ) : (
          <View style={styles.card}>
            {state.error && (
              <View style={styles.errorRow}>
                <Text style={styles.errorText}>{state.error}</Text>
              </View>
            )}
            <View style={styles.actions}>
              <PrimaryButton
                title={isBusy ? `Opening browser…` : `Sign in with GitHub`}
                disabled={isBusy}
                onPress={() => {
                  void signIn(`github`)
                }}
              />
              <PrimaryButton
                title={isBusy ? `Opening browser…` : `Sign in with Google`}
                disabled={isBusy}
                variant="soft"
                onPress={() => {
                  void signIn(`google`)
                }}
              />
            </View>
            <Text style={styles.hint}>
              Opens a sign-in window pointed at dashboard.electric-sql.cloud.
              The window closes automatically once you&apos;ve authorized.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    header: {
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `space-between`,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.divider,
    },
    headerTitle: {
      flex: 1,
      textAlign: `center`,
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    headerButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: `center`,
      justifyContent: `center`,
    },
    headerButtonPressed: {
      opacity: 0.6,
    },
    scroll: {
      padding: spacing.lg,
      gap: spacing.lg,
    },
    section: {
      gap: spacing.xs,
    },
    sectionTitle: {
      color: tokens.text1,
      fontSize: fontSize.xl,
      fontWeight: `500`,
      lineHeight: lineHeight.xl,
    },
    sectionCopy: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    card: {
      backgroundColor: tokens.surface,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border1,
      padding: spacing.md,
      gap: spacing.md,
    },
    row: {
      flexDirection: `row`,
      alignItems: `flex-start`,
      justifyContent: `space-between`,
      gap: spacing.md,
    },
    rowLabel: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      paddingTop: 2,
    },
    rowValue: {
      flex: 1,
      alignItems: `flex-end`,
      gap: 2,
    },
    rowValueText: {
      color: tokens.text1,
      fontSize: fontSize.sm,
      textAlign: `right`,
    },
    rowValueMuted: {
      color: tokens.text3,
    },
    principalText: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      textAlign: `right`,
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.divider,
    },
    actions: {
      gap: spacing.sm,
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
    hint: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
  })
}
