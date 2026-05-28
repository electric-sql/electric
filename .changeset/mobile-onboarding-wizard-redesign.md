---
"@electric-ax/agents-mobile": patch
---

Redesign mobile onboarding to mirror the desktop wizard and make it
mandatory until a server connection is saved.

* Two-step wizard (Cloud sign-in → Server selection) sharing the desktop
  wizard's visual anatomy — step indicator, step header, section cards,
  pinned footer respecting safe-area insets. Mobile has no local Horton
  runtime so the "model providers" step is omitted.
* Cloud server picker rows commit the connection on tap via a new
  `onConnect(url)` callback, fixing the bug where tapping a cloud row
  populated the URL input instead of connecting. Manual self-hosted URL
  entry lives in a collapsible "Custom server" section with inline error
  display.
* Onboarding is now mandatory until `onComplete` saves a URL — the
  "Don't show this again" and "Skip for now" escape valves are removed.
  Invariant: `onboardingDismissed=true ⟹ serverUrl is set`.
* `ServerSetupScreen` is rewritten on top of the step-2 anatomy so the
  Settings → Server screen and the onboarding server step stay aligned.
* Cloud → server auto-advance is a one-shot per sign-in transition,
  seeded from `startStep` so warm restarts with a restored session
  don't silently re-advance when the user taps Back.
* `DiagnosticsScreen` gains a `__DEV__`-gated **Clear all local data**
  action that wipes AsyncStorage, signs out of Cloud, and reloads the
  JS bundle into a fresh onboarding flow. Copy mirrors the desktop
  Settings → General → Reset wording.
