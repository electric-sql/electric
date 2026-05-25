import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Github } from 'lucide-react'
import {
  cloudSignIn,
  loadApiKeysStatus,
  loadCloudAuthState,
  loadOnboardingState,
  onCloudAuthStateChanged,
  saveApiKeys as persistApiKeys,
  setOnboardingDismissed,
  type ApiKeysStatus,
  type CloudAuthState,
} from '../lib/server-connection'
import { Button, Dialog, Icon, Stack, Text } from '../ui'
import { ApiKeysForm } from './ApiKeysForm'
import styles from './OnboardingModal.module.css'

type Step = `cloud` | `keys`

/**
 * First-launch onboarding wizard for the Electron desktop app.
 *
 * Two steps:
 *  1. Sign in to Electric Cloud (GitHub / Google). Skippable.
 *  2. Configure provider API keys for the bundled local runtime.
 *     Skippable. Saving the keys ends onboarding.
 *
 * Web build: returns `null` — neither sign-in nor key storage is
 * meaningful in a regular browser tab.
 *
 * Persistence:
 *  - Shows automatically on every launch until the user clicks "Don't
 *    show this again" OR completes the API-keys step (saving the
 *    keys marks `onboardingDismissed=true` on its way out).
 *  - "Skip" on either step closes the modal without marking dismissed,
 *    so it reappears next launch — Settings → Account + Settings →
 *    General are the manual paths in the meantime.
 *
 * Step 1 auto-advances as soon as the cloud-auth state flips to
 * `signed-in`, so the user lands on step 2 without an extra click.
 * If they were already signed in when the app launched we open the
 * wizard directly on step 2 (cloud step has nothing to do).
 *
 * Replaces the previous `<ApiKeysModal>` — the keys-only flow is now
 * subsumed by this wizard. `ApiKeysForm` is still shared with
 * Settings → General.
 */
export function OnboardingModal(): React.ReactElement | null {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>(`cloud`)
  const [cloudState, setCloudState] = useState<CloudAuthState | null>(null)
  const [keysStatus, setKeysStatus] = useState<ApiKeysStatus | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false

    void (async () => {
      const [onboarding, cloud, keys] = await Promise.all([
        loadOnboardingState(),
        loadCloudAuthState(),
        loadApiKeysStatus(),
      ])
      if (cancelled) return
      setCloudState(cloud)
      setKeysStatus(keys)
      setBootstrapped(true)

      if (!onboarding) return
      if (onboarding.dismissed) return
      // Already fully configured — nothing left to onboard, just
      // record dismissal so we don't pop the modal next launch.
      if (onboarding.signedIn && onboarding.hasAnyKey) {
        void setOnboardingDismissed(true)
        return
      }
      // Skip the cloud step if the user already has a restored
      // session — there's nothing to do there.
      setStep(onboarding.signedIn ? `keys` : `cloud`)
      setOpen(true)
    })()

    const unsubscribe = onCloudAuthStateChanged((next) => {
      setCloudState(next)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [isDesktop])

  // Auto-advance from cloud → keys as soon as sign-in completes.
  // We only do this while the wizard is open and on the cloud step;
  // otherwise the same status flip from Settings → Account would
  // also jump the user to the keys step, which is wrong.
  useEffect(() => {
    if (!open) return
    if (step !== `cloud`) return
    if (cloudState?.status === `signed-in`) {
      setStep(`keys`)
    }
  }, [open, step, cloudState?.status])

  const closeModal = useMemo(
    () => () => {
      setOpen(false)
    },
    []
  )

  const dismissForever = useMemo(
    () => () => {
      void setOnboardingDismissed(true)
      setOpen(false)
    },
    []
  )

  if (!isDesktop) return null
  if (!bootstrapped) return null
  if (!keysStatus) return null

  const cloudStatus = cloudState?.status ?? `signed-out`
  const cloudSigningIn = cloudStatus === `signing-in`
  const cloudSignedIn = cloudStatus === `signed-in`

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
      }}
    >
      <Dialog.Content maxWidth={520}>
        <StepIndicator step={step} />
        {step === `cloud` ? (
          <>
            <Dialog.Title>Welcome to Electric Agents</Dialog.Title>
            <Dialog.Description>
              Sign in to Electric Cloud so your local runtime can use your
              workspaces and the dashboard. You can skip this and configure it
              later from Settings → Account.
            </Dialog.Description>
            {cloudSignedIn ? (
              <div className={styles.signedInBanner}>
                <Icon icon={CheckCircle2} size={2} />
                <Text size={2} tone="muted">
                  {cloudState?.name
                    ? `Signed in as ${cloudState.name}.`
                    : `Signed in.`}
                </Text>
              </div>
            ) : (
              <Stack direction="column" gap={3}>
                {cloudState?.error && (
                  <Text size={2} tone="danger">
                    {cloudState.error}
                  </Text>
                )}
                <div className={styles.providerButtons}>
                  <Button
                    variant="solid"
                    tone="neutral"
                    size={2}
                    disabled={cloudSigningIn}
                    onClick={() => {
                      void cloudSignIn(`github`)
                    }}
                  >
                    <Icon icon={Github} size={2} />
                    Sign in with GitHub
                  </Button>
                  <Button
                    variant="soft"
                    tone="neutral"
                    size={2}
                    disabled={cloudSigningIn}
                    onClick={() => {
                      void cloudSignIn(`google`)
                    }}
                  >
                    Sign in with Google
                  </Button>
                </div>
                <Text size={1} tone="muted">
                  Opens a sign-in window pointed at
                  dashboard.electric-sql.cloud. The window closes automatically
                  once you've authorized.
                </Text>
              </Stack>
            )}
            <div className={styles.providerActions}>
              <Button
                type="button"
                variant="soft"
                tone="neutral"
                onClick={() => setStep(`keys`)}
              >
                {cloudSignedIn ? `Continue` : `Skip`}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Dialog.Title>Set up your API keys</Dialog.Title>
            <Dialog.Description>
              Electric Agents bundles a local runtime that calls the LLM
              provider of your choice. Provide an Anthropic, OpenAI, or DeepSeek
              API key (you can configure more than one) — stored on this machine
              only. Brave Search is optional and powers the web-search tool.
            </Dialog.Description>
            <ApiKeysForm
              initial={{
                anthropic:
                  keysStatus.suggested.anthropic ??
                  keysStatus.saved.anthropic ??
                  ``,
                openai:
                  keysStatus.suggested.openai ?? keysStatus.saved.openai ?? ``,
                deepseek:
                  keysStatus.suggested.deepseek ??
                  keysStatus.saved.deepseek ??
                  ``,
                brave:
                  keysStatus.suggested.brave ?? keysStatus.saved.brave ?? ``,
              }}
              showSuggestionHint={Boolean(
                keysStatus.suggested.anthropic ||
                  keysStatus.suggested.openai ||
                  keysStatus.suggested.deepseek ||
                  keysStatus.suggested.brave
              )}
              autoFocus
              onSave={async ({ anthropic, openai, deepseek, brave }) => {
                await persistApiKeys({
                  anthropic: anthropic.trim() || null,
                  openai: openai.trim() || null,
                  deepseek: deepseek.trim() || null,
                  brave: brave.trim() || null,
                })
                // Finishing the keys step means onboarding is done.
                // Persist that so we don't pop the modal on next launch.
                await setOnboardingDismissed(true)
                closeModal()
                const next = await loadApiKeysStatus()
                if (next) setKeysStatus(next)
              }}
              onSecondary={closeModal}
              secondaryLabel="Skip for now"
              saveLabel="Save & finish"
            />
          </>
        )}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.footerLink}
            onClick={dismissForever}
          >
            Don't show this again
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function StepIndicator({ step }: { step: Step }): React.ReactElement {
  return (
    <div className={styles.steps} aria-hidden>
      <span
        className={[
          styles.stepDot,
          step === `cloud` ? styles.stepDotActive : ``,
        ]
          .filter(Boolean)
          .join(` `)}
      />
      <span className={styles.stepBar} />
      <span
        className={[styles.stepDot, step === `keys` ? styles.stepDotActive : ``]
          .filter(Boolean)
          .join(` `)}
      />
    </div>
  )
}
