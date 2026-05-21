// Gesture handler MUST be first so its native HostFunctions are installed
// before Expo Router loads any screens using gesture-backed components.
import 'react-native-gesture-handler'

// Crypto polyfill must run before TanStack DB and other libs assume
// `crypto.randomUUID()` is available at module-load time. With Hermes
// + RN 0.81 it usually is, but the polyfill is a no-op in that case
// and a safety net otherwise. Keep this above ALL other imports.
import 'react-native-random-uuid'

import 'expo-router/entry'
