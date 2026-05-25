---
'@electric-ax/agents-mobile': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-runtime': patch
---

Prepare the mobile app for Expo EAS builds and CI. Adds dynamic Expo config, EAS build profiles, mobile CI/export scripts, and aligns shared React/TypeScript dependency resolution so the Expo DOM embed typechecks and passes `expo-doctor`.
