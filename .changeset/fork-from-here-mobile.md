---
'@electric-ax/agents-server-ui': patch
---

Make the "Fork from here" affordance work in the mobile Expo DOM embed. Two pieces: (1) wire the fork-anchor map in `ChatLogView` (the view the mobile embed mounts) so `EntityTimeline` actually receives the per-row callbacks; (2) add a `:global(html[data-electric-mobile-dom='true']) .forkButton { opacity: 1 }` rule in `UserMessage.module.css` so the button is visible without a hover/tap (touch devices don't fire `:hover`). The fork POST and post-fork navigation already route through the existing `serverFetch` + `onRequestOpenEntity` callback, so no changes to the mobile package itself.
