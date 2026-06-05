---
"@electric-ax/agents-mobile": patch
---

Add Sentry crash/error reporting to the mobile app: errors-only reporting disabled in development, with source-map upload wired through the `withSentry` Expo config plugin and `getSentryExpoConfig` metro wrapper.
