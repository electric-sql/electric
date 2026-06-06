import { useRouter } from 'expo-router'
import { OnboardingScreen } from '../src/screens/OnboardingScreen'
import { useMobileAppState } from '../src/lib/MobileAppState'
import { useCloudAuth } from '../src/lib/CloudAuthContext'

/**
 * First-launch onboarding route. The root layout redirects users here
 * while `onboardingDismissed` is false; the wizard is mandatory until
 * a server connection is confirmed via `onComplete`.
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
    />
  )
}
