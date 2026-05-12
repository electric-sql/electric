import { useRouter } from 'expo-router'
import { ServerSetupScreen } from '../src/screens/ServerSetupScreen'
import { useMobileAppState } from '../src/lib/MobileAppState'

export default function ServerSetupRoute(): React.ReactElement {
  const router = useRouter()
  const {
    serverUrl,
    servers,
    saveServerUrl,
    setActiveServerUrl,
    removeServer,
  } = useMobileAppState()

  return (
    <ServerSetupScreen
      initialUrl={serverUrl ?? undefined}
      servers={servers}
      activeUrl={serverUrl}
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
      onSelectServer={async (next) => {
        await setActiveServerUrl(next)
        router.replace(`/`)
      }}
      onRemoveServer={async (url) => {
        await removeServer(url)
      }}
    />
  )
}
