---
'@electric-ax/agents-mobile': patch
---

Polish the mobile app for App Store / Play review: declare the iOS privacy manifest for required-reason APIs (AsyncStorage + Sentry), drop the unused microphone permission and block legacy Android storage permissions, add a splash screen, ship an opaque iOS icon and a monochrome Android adaptive-icon layer, add `expo-system-ui` so `userInterfaceStyle` applies on Android, wrap the app in a recoverable error boundary, add a timeout escape hatch to the OAuth callback, and keep auth diagnostics out of production logs.
