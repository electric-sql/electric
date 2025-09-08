---
"@core/sync-service": patch
---

Ensure flush tracker handles progressive flush acknowledgements under continuous use. Fixes issue where under heavy load acknowledgements would be delayed.
