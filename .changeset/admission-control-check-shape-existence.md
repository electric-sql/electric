---
'@core/sync-service': patch
---

Classify admission control requests by actual shape existence instead of offset value. Prevents shape creation storms after restarts/redeploys from bypassing initial request limits, and avoids penalising reconnecting clients to shared shapes.
