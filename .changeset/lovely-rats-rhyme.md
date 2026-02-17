---
'@electric-sql/client': patch
---

Fix handling of deprecated 204 responses from old Electric servers. Previously, a 204 ("no content, you're caught up") only updated `lastSyncedAt` but never transitioned to the live state, so `isUpToDate` stayed false, `live=true` was never added to the URL, and subscribers waiting for the up-to-date signal were never notified. The bug is inert with current servers (which never send 204) but would cause an infinite catch-up polling loop against older servers.
