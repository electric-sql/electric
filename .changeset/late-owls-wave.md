---
'@electric-sql/client': patch
---

Expose the ShapeStream.fetchSnapshot as a public api that can be used to fetch a snapshot without it being injected into the emitted stream of change messages. This is useful for cases where the user wants to handle the application of these snapshot in a custom way.
