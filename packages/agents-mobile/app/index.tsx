import { useRouter } from 'expo-router'
import { SessionListScreen } from '../src/screens/SessionListScreen'
import { useAgentsRouteGuard } from '../src/lib/useAgentsRouteGuard'

export default function SessionsRoute(): React.ReactElement | null {
  const router = useRouter()
  const guard = useAgentsRouteGuard()
  if (guard) return guard

  return (
    <SessionListScreen
      onOpenSession={(entityUrl) => {
        router.push({
          pathname: `/session`,
          params: { entityUrl, view: `chat` },
        })
      }}
      onNewSession={() => router.push(`/new-session`)}
      onChangeServer={() => router.push(`/server-setup`)}
      onOpenDiagnostics={() => router.push(`/diagnostics`)}
      onOpenAccount={() => router.push(`/account`)}
    />
  )
}
