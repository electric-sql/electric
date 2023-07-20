---
"@core/electric": patch
---

Fixed the issue whereby calling electrify() on a previously electrified table caused a duplicate migration to be created and put onto the replication stream.
