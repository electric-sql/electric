import { useRouter } from 'expo-router'
import { ServerSetupScreen } from '../src/screens/ServerSetupScreen'
import { useMobileAppState } from '../src/lib/MobileAppState'

export default function ServerSetupRoute(): React.ReactElement {
  const router = useRouter()
  const { serverUrl, saveServerUrl } = useMobileAppState()

  return (
    <ServerSetupScreen
      initialUrl={serverUrl ?? undefined}
      onCancel={
        serverUrl
          ? () => {
              if (router.canGoBack()) router.back()
              else router.replace(`/`)
            }
          : undefined
      }
      onSave={async (next) => {
        await saveServerUrl(next)
        router.replace(`/`)
      }}
    />
  )
}
