import { useEffect, useState } from 'react'
import { ExternalLink, Github, LogOut } from 'lucide-react'
import { Badge, Button, Icon, Stack, Text } from '../../../ui'
import { SettingsRow, SettingsScreen, SettingsSection } from '../SettingsScreen'
import {
  cloudOpenDashboard,
  cloudSignIn,
  cloudSignOut,
  loadCloudAuthState,
  onCloudAuthStateChanged,
  type CloudAuthState,
} from '../../../lib/server-connection'

/**
 * Settings → Account.
 *
 * Surfaces the Electric Cloud sign-in state and the GitHub / Google
 * sign-in buttons. The actual OAuth flow runs in the Electron main
 * process (`packages/agents-desktop/src/cloud-auth.ts`); this panel
 * just observes state and triggers verbs through the preload bridge.
 *
 * Hidden from the web build — without the Electron IPC there is no
 * place to safely hold the resulting JWT, so signing in from a regular
 * browser tab is the dashboard's job, not the runtime UI's.
 */
export function AccountPage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [state, setState] = useState<CloudAuthState | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadCloudAuthState().then((next) => {
      if (!cancelled) setState(next)
    })
    const unsubscribe = onCloudAuthStateChanged((next) => {
      setState(next)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [isDesktop])

  if (!isDesktop) {
    return (
      <SettingsScreen title="Account">
        <SettingsSection
          title="Electric Cloud"
          description="Sign-in is only available in the desktop build of Electric Agents."
        >
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              Open this app in the desktop runtime to sign in to your Electric
              Cloud account.
            </Text>
          </div>
        </SettingsSection>
      </SettingsScreen>
    )
  }

  const status = state?.status ?? `signed-out`
  const isBusy = status === `signing-in`
  const isSignedIn = status === `signed-in`
  const workspaces = state?.workspaces ?? null

  return (
    <SettingsScreen title="Account">
      <SettingsSection
        title="Electric Cloud"
        description={
          isSignedIn
            ? `Signed in. Your local Electric Agents runtime can authenticate against Electric Cloud as this user.`
            : `Sign in with the same provider you use on the Electric Cloud dashboard. Your JWT is stored encrypted on this machine.`
        }
      >
        {isSignedIn ? (
          <Stack direction="column" gap={3} style={{ padding: `16px` }}>
            <SettingsRow
              label="Account"
              description={
                state?.name && state?.email
                  ? `${state.name} (${state.email})`
                  : (state?.name ?? state?.email ?? `Signed in`)
              }
              control={
                <Badge tone="success" size={1}>
                  Signed in
                </Badge>
              }
            />
            <SettingsRow
              label="Workspaces"
              description={
                workspaces === null
                  ? `Loading…`
                  : workspaces.length === 0
                    ? `You don't have access to any workspaces yet.`
                    : undefined
              }
              control={
                workspaces && workspaces.length > 0 ? (
                  <Stack
                    direction="column"
                    gap={1}
                    align="end"
                    style={{ textAlign: `right` }}
                  >
                    {workspaces.map((w) => (
                      <Text key={w.id} size={2}>
                        {w.name}
                      </Text>
                    ))}
                  </Stack>
                ) : (
                  <span />
                )
              }
            />
            <Stack direction="row" gap={2} style={{ marginTop: `8px` }}>
              <Button
                variant="solid"
                tone="neutral"
                size={2}
                onClick={() => {
                  void cloudOpenDashboard()
                }}
              >
                <Icon icon={ExternalLink} size={2} />
                Open Electric Cloud dashboard
              </Button>
              <Button
                variant="soft"
                tone="neutral"
                size={2}
                onClick={() => {
                  void cloudSignOut()
                }}
              >
                <Icon icon={LogOut} size={2} />
                Sign out
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack direction="column" gap={3} style={{ padding: `16px` }}>
            {state?.error && (
              <Text size={2} tone="danger">
                {state.error}
              </Text>
            )}
            <Stack direction="row" gap={2}>
              <Button
                variant="solid"
                tone="neutral"
                size={2}
                disabled={isBusy}
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
                disabled={isBusy}
                onClick={() => {
                  void cloudSignIn(`google`)
                }}
              >
                Sign in with Google
              </Button>
            </Stack>
            <Text size={1} tone="muted">
              Opens a sign-in window pointed at{` `}
              <Text size={1} tone="muted">
                dashboard.electric-sql.cloud
              </Text>
              . The window closes automatically once you've authorized.
            </Text>
          </Stack>
        )}
      </SettingsSection>
    </SettingsScreen>
  )
}
