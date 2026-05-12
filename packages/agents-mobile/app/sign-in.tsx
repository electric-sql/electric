import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SignInScreen } from '../src/screens/SignInScreen'
import type { CloudAuthProvider } from '../src/lib/cloudAuth'

/**
 * Modal-style route hosting the WebView OAuth flow. The provider is
 * passed in via query (`/sign-in?provider=github`) so the parent route
 * can pick which one to open without juggling component-level state.
 *
 * The caller (Account screen) is responsible for flipping auth state
 * into `signing-in` *before* navigating here — keeps state transitions
 * close to the user gesture and saves us an effect dependency on the
 * auth context.
 */
export default function SignInRoute(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams<{ provider?: string }>()
  const provider: CloudAuthProvider | null =
    params.provider === `github` || params.provider === `google`
      ? params.provider
      : null

  if (!provider) {
    return <Redirect href="/account" />
  }

  return (
    <SignInScreen
      provider={provider}
      onClose={() => {
        if (router.canGoBack()) router.back()
        else router.replace(`/account`)
      }}
    />
  )
}
