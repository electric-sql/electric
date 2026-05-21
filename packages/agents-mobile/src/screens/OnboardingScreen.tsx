import { useEffect, useMemo, useState } from 'react'
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
import { CloudServerPicker } from '../components/CloudServerPicker'
import { Icon } from '../components/Icon'
import { PrimaryButton } from '../components/PrimaryButton'
import { Screen } from '../components/Screen'
import { useCloudAuth } from '../lib/CloudAuthContext'
import { checkServerHealth, normalizeServerUrl } from '../lib/agentsClient'
import { prepareServerHeaders } from '../lib/serverHeaders'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

type Step = `cloud` | `server`

/**
 * First-launch onboarding wizard for the mobile app. Mirrors the
 * desktop wizard's spirit (sign-in to Electric Cloud → configure the
 * runtime) with the inputs that make sense on mobile:
 *
 *  1. Sign in to Electric Cloud (GitHub / Google). Skippable.
 *  2. Connect to an agents server. The mobile app doesn't bundle a
 *     local Horton runtime so the analog of the desktop "API keys"
 *     step is picking a remote server URL — the same input the
 *     standalone `ServerSetupScreen` exposes.
 *
 * Auto-advances from step 1 → step 2 as soon as cloud sign-in
 * completes. If the user is already signed in at boot we open the
 * wizard directly on step 2 (cloud step has nothing to do).
 *
 * Persistence: `onboardingDismissed` in `MobileAppState` (AsyncStorage).
 * Saving a server URL marks the wizard dismissed automatically; "Skip
 * for now" and the trailing "Don't show this again" link expose the
 * two manual escape hatches.
 *
 * Rendered by `app/onboarding.tsx`; the root layout redirects to it
 * on first launch in place of the bare `/server-setup` redirect.
 */
export function OnboardingScreen({
  initialServerUrl,
  startStep = `cloud`,
  onComplete,
  onDismissForever,
}: {
  initialServerUrl?: string | null
  startStep?: Step
  onComplete: (params: { serverUrl: string }) => Promise<void>
  onDismissForever: () => Promise<void>
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { state: cloudState, signIn } = useCloudAuth()
  const [step, setStep] = useState<Step>(startStep)
  const [serverUrlValue, setServerUrlValue] = useState(initialServerUrl ?? ``)
  const [submittingServer, setSubmittingServer] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const cloudStatus = cloudState.status
  const isSigningIn = cloudStatus === `signing-in`
  const isSignedIn = cloudStatus === `signed-in`

  // Auto-advance from cloud → server as soon as sign-in completes.
  // Only fires while the user is on the cloud step so a separate
  // future sign-in (e.g. from Account) doesn't snap them off whatever
  // step they were on.
  useEffect(() => {
    if (step === `cloud` && isSignedIn) {
      setStep(`server`)
    }
  }, [step, isSignedIn])

  const submitServer = async (): Promise<void> => {
    const normalized = normalizeServerUrl(serverUrlValue)
    if (!normalized) {
      setServerError(`Enter an agents server URL.`)
      return
    }
    setSubmittingServer(true)
    setServerError(null)
    try {
      // Inject Cloud auth headers (if applicable) before the health
      // check probes the server — Cloud agent servers reject
      // unauthenticated requests with 401.
      await prepareServerHeaders(normalized)
      await checkServerHealth(normalized)
      await onComplete({ serverUrl: normalized })
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmittingServer(false)
    }
  }

  const goNextFromCloud = (): void => {
    setStep(`server`)
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
          <StepIndicator step={step} styles={styles} />

          {step === `cloud` ? (
            <View style={styles.section}>
              <Text style={styles.eyebrow}>Electric Agents</Text>
              <Text style={styles.title}>Welcome</Text>
              <Text style={styles.copy}>
                Sign in to Electric Cloud so your agents can sync with your
                workspaces and the dashboard. You can skip this and set it up
                later from the Account screen.
              </Text>

              {isSignedIn ? (
                <View style={styles.signedInBanner}>
                  <Icon
                    name="check"
                    size={18}
                    color={tokens.green11}
                    strokeWidth={2}
                  />
                  <Text style={styles.signedInText}>
                    {cloudState.name
                      ? `Signed in as ${cloudState.name}.`
                      : `Signed in.`}
                  </Text>
                </View>
              ) : (
                <>
                  {cloudState.error && (
                    <View style={styles.errorRow}>
                      <Text style={styles.errorText}>{cloudState.error}</Text>
                    </View>
                  )}
                  <View style={styles.actions}>
                    <PrimaryButton
                      title={
                        isSigningIn ? `Opening browser…` : `Sign in with GitHub`
                      }
                      disabled={isSigningIn}
                      onPress={() => {
                        void signIn(`github`)
                      }}
                    />
                    <PrimaryButton
                      title={
                        isSigningIn ? `Opening browser…` : `Sign in with Google`
                      }
                      variant="soft"
                      disabled={isSigningIn}
                      onPress={() => {
                        void signIn(`google`)
                      }}
                    />
                  </View>
                  <Text style={styles.hint}>
                    Opens a sign-in window pointed at
                    dashboard.electric-sql.cloud. It closes automatically once
                    you&apos;ve authorized.
                  </Text>
                </>
              )}

              <View style={styles.secondaryAction}>
                <PrimaryButton
                  title={isSignedIn ? `Continue` : `Skip`}
                  variant="ghost"
                  onPress={goNextFromCloud}
                />
              </View>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.eyebrow}>Step 2 of 2</Text>
              <Text style={styles.title}>Connect to an agents server</Text>
              <Text style={styles.copy}>
                Mobile connects to a running server. It does not bundle a local
                Horton runtime.
              </Text>

              <CloudServerPicker
                onPick={(picked) => setServerUrlValue(picked)}
                disabled={submittingServer}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Server URL</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://agents.example.com"
                  placeholderTextColor={tokens.text3}
                  value={serverUrlValue}
                  onChangeText={setServerUrlValue}
                  onSubmitEditing={() => {
                    void submitServer()
                  }}
                  returnKeyType="go"
                  style={styles.input}
                />
              </View>

              {serverError && (
                <View style={styles.errorRow}>
                  <Text style={styles.errorText}>{serverError}</Text>
                </View>
              )}

              <View style={styles.actions}>
                <PrimaryButton
                  title="Connect & finish"
                  loading={submittingServer}
                  disabled={submittingServer}
                  onPress={() => {
                    void submitServer()
                  }}
                />
                <PrimaryButton
                  title="Skip for now"
                  variant="ghost"
                  disabled={submittingServer}
                  onPress={() => {
                    // Closes the wizard without persisting a URL. The
                    // root layout's `!serverUrl` redirect will kick the
                    // user back to /server-setup until they configure
                    // one, so this is a "remind me later" path.
                    void onDismissForever()
                  }}
                />
              </View>
            </View>
          )}

          <Pressable
            onPress={() => {
              void onDismissForever()
            }}
            hitSlop={spacing.sm}
            style={({ pressed }) => [
              styles.dismissForever,
              pressed ? styles.dismissForeverPressed : null,
            ]}
          >
            <Text style={styles.dismissForeverText}>
              Don&apos;t show this again
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function StepIndicator({
  step,
  styles,
}: {
  step: Step
  styles: ReturnType<typeof createStyles>
}): React.ReactElement {
  return (
    <View style={styles.steps}>
      <View
        style={[styles.stepDot, step === `cloud` ? styles.stepDotActive : null]}
      />
      <View style={styles.stepBar} />
      <View
        style={[
          styles.stepDot,
          step === `server` ? styles.stepDotActive : null,
        ]}
      />
    </View>
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
    steps: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      alignSelf: `center`,
      marginBottom: spacing.md,
    },
    stepDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: tokens.border2,
    },
    stepDotActive: {
      backgroundColor: tokens.text1,
    },
    stepBar: {
      width: 24,
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.divider,
    },
    section: {
      gap: spacing.md,
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
    signedInBanner: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      backgroundColor: tokens.greenA3,
    },
    signedInText: {
      color: tokens.green11,
      fontSize: fontSize.sm,
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
      gap: spacing.sm,
    },
    hint: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    secondaryAction: {
      alignSelf: `flex-end`,
      marginTop: spacing.sm,
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
    dismissForever: {
      alignSelf: `center`,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    dismissForeverPressed: {
      opacity: 0.6,
    },
    dismissForeverText: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      textDecorationLine: `underline`,
    },
  })
}
