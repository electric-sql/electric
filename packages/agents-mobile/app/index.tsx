import { useRouter } from 'expo-router'
import { SessionListScreen } from '../src/screens/SessionListScreen'

export default function SessionsRoute(): React.ReactElement {
  const router = useRouter()

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
    />
  )
}
