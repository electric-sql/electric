// Crypto polyfill MUST be first — TanStack DB and other libs assume
// `crypto.randomUUID()` is available at module-load time. With Hermes
// + RN 0.81 it usually is, but the polyfill is a no-op in that case
// and a safety net otherwise. Keep this above ALL other imports.
import 'react-native-random-uuid'

import { registerRootComponent } from 'expo'
import App from './App'

registerRootComponent(App)
