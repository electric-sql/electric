---
"@electric-sql/client": minor
---

[BREAKING] Remove subscribeOnceToUpToDate method from ShapeStream. Instead, you should subscribe to the stream and check for the up-to-date control message.
