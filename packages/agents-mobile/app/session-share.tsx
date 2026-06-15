import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { ShareSessionScreen } from '../src/screens/ShareSessionScreen'
import { useAgentsRouteGuard } from '../src/lib/useAgentsRouteGuard'

export default function SessionShareRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<{ entityUrl?: string }>()
  const router = useRouter()
  const guard = useAgentsRouteGuard()
  if (guard) return guard

  const entityUrl = Array.isArray(params.entityUrl)
    ? params.entityUrl[0]
    : (params.entityUrl ?? ``)

  return (
    <>
      <Stack.Screen options={{ presentation: `modal` }} />
      <ShareSessionScreen
        entityUrl={entityUrl}
        onBack={() => {
          if (router.canGoBack()) router.back()
          else router.replace(`/`)
        }}
      />
    </>
  )
}
