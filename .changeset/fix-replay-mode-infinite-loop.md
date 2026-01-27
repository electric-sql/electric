---
'@electric-sql/client': patch
---

Fix infinite loop in replay mode when CDN returns the same cursor repeatedly. The client now exits replay mode after the first suppressed up-to-date notification, preventing the loop while still correctly suppressing duplicate notifications from cached responses.
