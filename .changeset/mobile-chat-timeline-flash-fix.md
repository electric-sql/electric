---
'@electric-ax/agents-mobile': patch
'@electric-ax/agents-server-ui': patch
---

Fix mobile chat timeline flashing when sending messages, resizing the composer (multiline/attachments) and queuing messages, and fix inconsistent auto-scroll as the composer grows. The timeline WebView embed now receives dynamic updates (bottom inset, inline queued messages, scroll) imperatively instead of via props that re-render and flash it.
