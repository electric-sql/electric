import { useRouter } from 'expo-router'
import { NewSessionScreen } from '../src/screens/NewSessionScreen'

export default function NewSessionRoute(): React.ReactElement {
  const router = useRouter()

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
