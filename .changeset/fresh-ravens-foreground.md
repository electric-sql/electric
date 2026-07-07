---
"@electric-sql/client": patch
---

Use the React Native package export to wire AppState lifecycle handling in Metro/Expo builds, replacing brittle runtime `require('react-native')` auto-detection while keeping `runtimeVisibility` as an explicit escape hatch.
