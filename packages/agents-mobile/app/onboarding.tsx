import { useRouter } from 'expo-router'
import { OnboardingScreen } from '../src/screens/OnboardingScreen'
import { useMobileAppState } from '../src/lib/MobileAppState'
import { useCloudAuth } from '../src/lib/CloudAuthContext'

/**
 * First-launch onboarding route. The root layout redirects users here
 * when `onboardingDismissed` is false; the wizard either finishes
 * (server URL saved → dismissed → home) or is opted out of (footer
 * link / "Skip for now" → dismissed → either home or the existing
 * `/server-setup` redirect if no URL is set yet).
 */
export default function OnboardingRoute(): React.ReactElement {
  const router = useRouter()
  const { serverUrl, saveServerUrl, setOnboardingDismissed } =
    useMobileAppState()
  const { state: cloudState } = useCloudAuth()

  return (
    <OnboardingScreen
      initialServerUrl={serverUrl}
      // If a session is already restored at boot we open straight on
      // the server step — nothing to do on the cloud step.
      startStep={cloudState.status === `signed-in` ? `server` : `cloud`}
      onComplete={async ({ serverUrl: nextUrl }) => {
        await saveServerUrl(nextUrl)
        await setOnboardingDismissed(true)
        router.replace(`/`)
      }}
      onDismissForever={async () => {
        await setOnboardingDismissed(true)
        // If the user dismisses without configuring a server, the root
        // layout's `!serverUrl` redirect picks them up and forces them
        // onto `/server-setup` next render.
        router.replace(`/`)
      }}
    />
  )
}
