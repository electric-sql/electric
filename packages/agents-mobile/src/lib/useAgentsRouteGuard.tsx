import { Redirect } from 'expo-router'
import { useMobileAppState } from './MobileAppState'

/**
 * Guard for routes whose screens call `useAgents()`.
 *
 * `AgentsProvider` is only mounted in the root layout when a
 * `serverUrl` is set, so any screen that depends on it will crash
 * with `useAgents must be used inside AgentsProvider` if it renders
 * before the user has finished onboarding and set up a server.
 *
 * The root layout already redirects unconfigured users to
 * `/onboarding` / `/server-setup`, but during a redirect chain
 * (notably the post-sign-in chain through `/oauth/callback`) Expo
 * Router briefly mounts the destination route before the next render
 * of the layout's redirects catches up, so the protected screen can
 * still render for a render or two. This hook lets each protected
 * route bail synchronously instead of relying on the layout to land
 * the right pathname in time.
 *
 * Usage:
 *
 *   const guard = useAgentsRouteGuard()
 *   if (guard) return guard
 *   const { serverUrl } = useAgents()
 *   ...
 */
export function useAgentsRouteGuard(): React.ReactElement | null {
  const { loading, serverUrl, onboardingDismissed } = useMobileAppState()
  if (loading) return null
  if (!onboardingDismissed) return <Redirect href="/onboarding" />
  if (!serverUrl) return <Redirect href="/server-setup" />
  return null
}
