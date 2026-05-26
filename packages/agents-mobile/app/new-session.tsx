import { useRouter } from 'expo-router'
import { NewSessionScreen } from '../src/screens/NewSessionScreen'
import { useAgentsRouteGuard } from '../src/lib/useAgentsRouteGuard'

export default function NewSessionRoute(): React.ReactElement | null {
  const router = useRouter()
  const guard = useAgentsRouteGuard()
  if (guard) return guard

  return (
    <NewSessionScreen
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace(`/`)
      }}
      onOpenSession={(entityUrl) => {
        router.replace({
          pathname: `/session`,
          params: { entityUrl, view: `chat` },
        })
      }}
    />
  )
}
