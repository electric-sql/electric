import { useRouter } from 'expo-router'
import { DiagnosticsScreen } from '../src/screens/DiagnosticsScreen'

export default function DiagnosticsRoute(): React.ReactElement {
  const router = useRouter()

  return (
    <DiagnosticsScreen
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace(`/`)
      }}
    />
  )
}
