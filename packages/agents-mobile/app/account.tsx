import { useRouter } from 'expo-router'
import { AccountScreen } from '../src/screens/AccountScreen'

export default function AccountRoute(): React.ReactElement {
  const router = useRouter()

  return (
    <AccountScreen
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace(`/`)
      }}
    />
  )
}
