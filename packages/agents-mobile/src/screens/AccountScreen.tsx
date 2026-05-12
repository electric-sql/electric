import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Icon } from '../components/Icon'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useTokens } from '../lib/ThemeProvider'
import { useCloudAuth } from '../lib/CloudAuthContext'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { CloudAuthProvider } from '../lib/cloudAuth'
import type { Tokens } from '../lib/theme'

/**
 * Settings → Account screen. Mirrors the desktop's `AccountPage` —
 * shows the GitHub/Google sign-in buttons when signed out, and the
 * user's name + workspaces + dashboard link when signed in.
 *
 * The actual OAuth flow runs in `<SignInScreen>` (pushed as a separate
 * route). We just observe state through `useCloudAuth` here.
 */
export function AccountScreen({
  onBack,
  onStartSignIn,
}: {
  onBack: () => void
  onStartSignIn: (provider: CloudAuthProvider) => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const auth = useCloudAuth()
  const { state, beginSignIn, signOut, openDashboard } = auth
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
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Account</Text>
              <View style={styles.rowValue}>
                <Text style={styles.rowValueText} numberOfLines={2}>
                  {state.name && state.email
                    ? `${state.name} (${state.email})`
                    : (state.name ?? state.email ?? `Signed in`)}
                </Text>
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
                  beginSignIn(`github`)
                  onStartSignIn(`github`)
                }}
              />
              <PrimaryButton
                title={isBusy ? `Opening browser…` : `Sign in with Google`}
                disabled={isBusy}
                variant="soft"
                onPress={() => {
                  beginSignIn(`google`)
                  onStartSignIn(`google`)
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
