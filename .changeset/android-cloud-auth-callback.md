---
"@electric-ax/agents-mobile": patch
---

Fix Android Electric Cloud sign-in flow getting stuck after Google / GitHub auth.

The Chrome Custom Tab redirect (`electric-agents://oauth/callback?...`)
was being lost on real Android devices (especially Android 13+ release
builds), so the sign-in never completed and the user was bounced back
to the welcome screen. Multiple layers had to be hardened:

* **Config plugin** that injects an `onNewIntent` override into the
  generated `MainActivity.kt` so new intents (delivered when Android
  kills our process while the browser is open and then relaunches
  via the redirect) are forwarded to `getIntent()` for
  `expo-linking` / `expo-web-browser` to pick up. Mitigates
  [expo/expo#44284](https://github.com/expo/expo/issues/44284).
* `openAuthSessionAsync` now uses `createTask: false` +
  `showInRecents: true` so the Custom Tab runs inside our task and
  the OS doesn't aggressively reclaim our process while the user is
  signing in.
* The OAuth deep link is consumed by a **global listener mounted in
  `CloudAuthProvider`** (in addition to the `/oauth/callback`
  route), so cold-start redirects are completed even before Expo
  Router has had a chance to navigate to the route.
* `parseCallbackUrl` uses `expo-linking`'s `Linking.parse` rather
  than `new URL()`, which is unreliable for custom schemes in
  Hermes release builds.
* `signIn` waits a few seconds for the deep link to arrive when the
  browser session returns `dismiss`, instead of immediately
  rolling state back to `signed-out`.
* The `/oauth/callback` route now subscribes to the cloud-auth
  state and only navigates once it actually settles, surfacing
  parse / state-mismatch errors instead of silently bouncing the
  user back to the welcome screen.
