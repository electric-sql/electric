---
'@electric-ax/agents-server-ui': patch
---

Fix Agent UI message submission on mobile browsers. The Send button now keeps the textarea focused on tap so the on-screen keyboard does not dismiss and reflow the viewport mid-click, and the composer recognises the soft-keyboard return key via `enterKeyHint="send"` plus a `beforeinput` fallback (Android Chrome / GBoard route it as `insertLineBreak` without a matching `keydown`). The Enter handler now also ignores IME composition (`keyCode === 229`).
