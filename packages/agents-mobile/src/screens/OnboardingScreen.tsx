import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
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

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: `cloud`, label: `Cloud` },
  { id: `server`, label: `Server` },
]

/**
 * First-launch onboarding wizard. Two steps: Cloud sign-in (skippable)
 * and server selection. Mirrors the desktop wizard without the
 * model-providers step — mobile has no local Horton runtime.
 */
export function OnboardingScreen({
  initialServerUrl,
  startStep = `cloud`,
  onComplete,
}: {
  initialServerUrl?: string | null
  startStep?: Step
  onComplete: (params: { serverUrl: string }) => Promise<void>
}): React.ReactElement {
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { state: cloudState, signIn } = useCloudAuth()
  const [step, setStep] = useState<Step>(startStep)
  const [customUrlOpen, setCustomUrlOpen] = useState(false)
  const [customUrlValue, setCustomUrlValue] = useState(initialServerUrl ?? ``)
  const [submitting, setSubmitting] = useState(false)
  const [cloudConnectError, setCloudConnectError] = useState<string | null>(
    null
  )
  const [customUrlError, setCustomUrlError] = useState<string | null>(null)

  const cloudStatus = cloudState.status
  const isSigningIn = cloudStatus === `signing-in`
  const isSignedIn = cloudStatus === `signed-in`

  // Auto-advance from cloud → server on the sign-in transition only —
  // never on a manual `Back` while already signed in.
  const hasAutoAdvancedRef = useRef(false)
  useEffect(() => {
    if (!isSignedIn) {
      hasAutoAdvancedRef.current = false
    } else if (step === `cloud` && !hasAutoAdvancedRef.current) {
      hasAutoAdvancedRef.current = true
      setStep(`server`)
    }
  }, [step, isSignedIn])

  const commit = async (url: string): Promise<string | null> => {
    setSubmitting(true)
    try {
      // Cloud agent servers reject unauthenticated requests with 401,
      // so headers must be registered before the health probe.
      await prepareServerHeaders(url)
      await checkServerHealth(url)
      await onComplete({ serverUrl: url })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      setSubmitting(false)
    }
  }

  const connectCloudRow = async (url: string): Promise<void> => {
    setCloudConnectError(null)
    const err = await commit(url)
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
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <StepIndicator step={step} styles={styles} tokens={tokens} />

          {step === `cloud` ? (
            <CloudStep
              styles={styles}
              tokens={tokens}
              cloudError={cloudState.error}
              cloudName={cloudState.name}
              cloudEmail={cloudState.email}
              isSignedIn={isSignedIn}
              isSigningIn={isSigningIn}
              onSignIn={(provider) => {
                void signIn(provider)
              }}
            />
          ) : (
            <ServerStep
              styles={styles}
              tokens={tokens}
              submitting={submitting}
              cloudConnectError={cloudConnectError}
              customUrlError={customUrlError}
              customUrlOpen={customUrlOpen}
              customUrlValue={customUrlValue}
              isCloudSignedIn={isSignedIn}
              onSetCustomUrlValue={setCustomUrlValue}
              onToggleCustomUrl={toggleCustomUrl}
              onConnectCloudRow={connectCloudRow}
              onSubmitCustom={() => {
                void submitCustom()
              }}
              onSignInToCloud={() => setStep(`cloud`)}
            />
          )}
        </ScrollView>

        <View
          style={[
            styles.footerArea,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          {step === `cloud` ? (
            <CloudFooter
              isSignedIn={isSignedIn}
              onContinue={() => setStep(`server`)}
            />
          ) : (
            <ServerFooter
              submitting={submitting}
              onBack={() => setStep(`cloud`)}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

/* ── Footers (pinned to bottom of the viewport) ───────────── */

function CloudFooter({
  isSignedIn,
  onContinue,
}: {
  isSignedIn: boolean
  onContinue: () => void
}): React.ReactElement {
  return (
    <PrimaryButton
      title={isSignedIn ? `Continue` : `Continue without Cloud`}
      variant="soft"
      trailingIcon="chevron-right"
      onPress={onContinue}
    />
  )
}

function ServerFooter({
  submitting,
  onBack,
}: {
  submitting: boolean
  onBack: () => void
}): React.ReactElement {
  return (
    <PrimaryButton
      title="Back"
      variant="ghost"
      onPress={onBack}
      disabled={submitting}
    />
  )
}

/* ── Step content ──────────────────────────────────────────── */

function CloudStep({
  styles,
  tokens,
  cloudError,
  cloudName,
  cloudEmail,
  isSignedIn,
  isSigningIn,
  onSignIn,
}: {
  styles: ReturnType<typeof createStyles>
  tokens: Tokens
  cloudError: string | null
  cloudName: string | null
  cloudEmail: string | null
  isSignedIn: boolean
  isSigningIn: boolean
  onSignIn: (provider: `github` | `google`) => void
}): React.ReactElement {
  return (
    <View style={styles.step}>
      <StepHeader
        styles={styles}
        title="Electric Cloud"
        description="The data platform for multi-agent systems. Sign in to discover hosted agents servers, provision new ones, and connect this app to your Electric Cloud workspaces."
      />

      {isSignedIn ? (
        <View style={styles.section}>
          <View style={styles.signedInRow}>
            <View style={styles.signedInIcon}>
              <Icon
                name="check"
                size={16}
                color={tokens.green11}
                strokeWidth={2}
              />
            </View>
            <View style={styles.signedInText}>
              <Text style={styles.signedInTitle}>
                {cloudName || `Signed in`}
              </Text>
              {cloudEmail && (
                <Text style={styles.signedInMeta}>{cloudEmail}</Text>
              )}
            </View>
          </View>
        </View>
      ) : (
        <>
          {cloudError && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{cloudError}</Text>
            </View>
          )}
          <View style={styles.actionsStack}>
            <PrimaryButton
              title={isSigningIn ? `Opening browser…` : `Sign in with GitHub`}
              leadingIcon="github"
              disabled={isSigningIn}
              onPress={() => onSignIn(`github`)}
            />
            <PrimaryButton
              title={isSigningIn ? `Opening browser…` : `Sign in with Google`}
              variant="soft"
              leadingIcon="google"
              disabled={isSigningIn}
              onPress={() => onSignIn(`google`)}
            />
          </View>
          <Text style={styles.hint}>
            Opens a sign-in window pointed at dashboard.electric-sql.cloud. It
            closes automatically once you&apos;ve authorized.
          </Text>
          <Text style={styles.hint}>
            By signing in, you agree to our{` `}
            <Text
              style={styles.legalLink}
              onPress={() => {
                void WebBrowser.openBrowserAsync(
                  `https://electric.ax/about/legal/terms`
                )
              }}
            >
              terms of service
            </Text>
            {` `}and{` `}
            <Text
              style={styles.legalLink}
              onPress={() => {
                void WebBrowser.openBrowserAsync(
                  `https://electric.ax/about/legal/privacy`
                )
              }}
            >
              privacy policy
            </Text>
            .
          </Text>
        </>
      )}
    </View>
  )
}

function ServerStep({
  styles,
  tokens,
  submitting,
  cloudConnectError,
  customUrlError,
  customUrlOpen,
  customUrlValue,
  isCloudSignedIn,
  onSetCustomUrlValue,
  onToggleCustomUrl,
  onConnectCloudRow,
  onSubmitCustom,
  onSignInToCloud,
}: {
  styles: ReturnType<typeof createStyles>
  tokens: Tokens
  submitting: boolean
  cloudConnectError: string | null
  customUrlError: string | null
  customUrlOpen: boolean
  customUrlValue: string
  isCloudSignedIn: boolean
  onSetCustomUrlValue: (next: string) => void
  onToggleCustomUrl: () => void
  onConnectCloudRow: (url: string) => Promise<void>
  onSubmitCustom: () => void
  onSignInToCloud: () => void
}): React.ReactElement {
  return (
    <View style={styles.step}>
      <StepHeader
        styles={styles}
        title="Choose your first server"
        description="Pick the agents server this app should connect to."
      />

      {!isCloudSignedIn && (
        <SectionHeader
          styles={styles}
          title="Electric Cloud"
          description="Sign in to Electric Cloud to discover and provision hosted agents servers."
          action={
            <PrimaryButton
              title="Sign in"
              variant="soft"
              onPress={onSignInToCloud}
              disabled={submitting}
            />
          }
        />
      )}

      <CloudServerPicker onConnect={onConnectCloudRow} disabled={submitting} />

      {cloudConnectError && (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>{cloudConnectError}</Text>
        </View>
      )}

      <SectionHeader
        styles={styles}
        title="Custom server"
        description="Connect to a self-hosted agents server."
        action={
          <PrimaryButton
            title={customUrlOpen ? `Cancel` : `Add custom URL`}
            variant="ghost"
            onPress={onToggleCustomUrl}
            disabled={submitting}
          />
        }
      />

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
              onChangeText={onSetCustomUrlValue}
              onSubmitEditing={onSubmitCustom}
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
            onPress={onSubmitCustom}
          />
        </View>
      )}
    </View>
  )
}

/* ── Local primitives ─────────────────────────────────────── */

function StepIndicator({
  step,
  styles,
  tokens,
}: {
  step: Step
  styles: ReturnType<typeof createStyles>
  tokens: Tokens
}): React.ReactElement {
  const currentIndex = STEPS.findIndex((s) => s.id === step)
  return (
    <View style={styles.steps}>
      {STEPS.map((item, idx) => {
        const isActive = idx === currentIndex
        const isComplete = idx < currentIndex
        return (
          <Fragment key={item.id}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  isActive ? styles.stepCircleActive : null,
                  isComplete ? styles.stepCircleComplete : null,
                ]}
              >
                {isComplete ? (
                  <Icon
                    name="check"
                    size={14}
                    color={tokens.green11}
                    strokeWidth={2.5}
                  />
                ) : (
                  <Text
                    style={[
                      styles.stepNumber,
                      isActive ? styles.stepNumberActive : null,
                    ]}
                  >
                    {idx + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  isActive ? styles.stepLabelActive : null,
                ]}
              >
                {item.label}
              </Text>
            </View>
            {idx < STEPS.length - 1 && <View style={styles.stepBar} />}
          </Fragment>
        )
      })}
    </View>
  )
}

function StepHeader({
  styles,
  eyebrow,
  title,
  description,
}: {
  styles: ReturnType<typeof createStyles>
  eyebrow?: string
  title: string
  description: string
}): React.ReactElement {
  return (
    <View style={styles.stepHeader}>
      {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  )
}

function SectionHeader({
  styles,
  title,
  description,
  action,
}: {
  styles: ReturnType<typeof createStyles>
  title: string
  description?: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
        {description && (
          <Text style={styles.sectionHeaderDescription}>{description}</Text>
        )}
      </View>
      {action && <View style={styles.sectionHeaderAction}>{action}</View>}
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      gap: spacing.lg,
    },

    // Step indicator — compact centered group; bar width fixed so the
    // two steps read as one widget rather than floating apart.
    steps: {
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `center`,
      gap: spacing.sm,
    },
    stepItem: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
    },
    stepCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tokens.border2,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.surface,
    },
    stepCircleActive: {
      backgroundColor: tokens.text1,
      borderColor: tokens.text1,
    },
    stepCircleComplete: {
      backgroundColor: tokens.greenA3,
      borderColor: tokens.greenA3,
    },
    stepNumber: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      fontWeight: `600`,
    },
    stepNumberActive: {
      color: tokens.textOnAccent,
    },
    stepLabel: {
      color: tokens.text3,
      fontSize: fontSize.sm,
      fontWeight: `500`,
    },
    stepLabelActive: {
      color: tokens.text1,
    },
    stepBar: {
      width: 32,
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.divider,
    },

    // Step content
    step: {
      gap: spacing.md,
    },
    stepHeader: {
      gap: spacing.xs,
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
    description: {
      color: tokens.text2,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
    },

    // Cloud step signed-in row
    section: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      overflow: `hidden`,
    },
    signedInRow: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    signedInIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: tokens.greenA3,
      alignItems: `center`,
      justifyContent: `center`,
    },
    signedInText: {
      flex: 1,
      gap: 2,
    },
    signedInTitle: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    signedInMeta: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },

    actionsStack: {
      gap: spacing.md,
    },
    hint: {
      color: tokens.text3,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    legalLink: {
      color: tokens.text2,
      textDecorationLine: `underline`,
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

    // Custom-URL affordance
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

    // Lives outside the ScrollView so escape actions stay pinned at
    // thumb reach rather than flowing with content.
    footerArea: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border1,
      backgroundColor: tokens.bg,
      gap: spacing.sm,
    },
  })
}
