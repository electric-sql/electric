---
'@electric-sql/client': patch
---

Stop skipping rows when an SSE response ends before its up-to-date. The client
took the response's `electric-offset` header when it opened, so a body that
broke, or a catch-up chunk without an up-to-date, lost its rows. The offset now
moves only with an up-to-date, and after such a body the client long polls from
the same offset until it is up to date again.
