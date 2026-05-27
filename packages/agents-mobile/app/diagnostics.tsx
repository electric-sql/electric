import { useRouter } from 'expo-router'
import { DiagnosticsScreen } from '../src/screens/DiagnosticsScreen'
import { useAgentsRouteGuard } from '../src/lib/useAgentsRouteGuard'

export default function DiagnosticsRoute(): React.ReactElement | null {
  const router = useRouter()
  const guard = useAgentsRouteGuard()
  if (guard) return guard

  return (
    <DiagnosticsScreen
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace(`/`)
      }}
    />
  )
}
