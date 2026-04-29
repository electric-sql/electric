---
'@electric-ax/agents-server': patch
---

Pull in the latest `@electric-ax/agents-server-ui` bundle: replaces the old editorial/control/workshop font-theme picker with a single dark-mode toggle in the sidebar footer, and rewires `styles.css` to the Electric Agents brand palette (warm-stone light + deep-night dark, with navy/teal accents). Preference persists to `localStorage` and falls back to `prefers-color-scheme`.
