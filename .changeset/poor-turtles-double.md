---
"@core/sync-service": minor
---

Replace individual persistence location configuration with a single `STORAGE_DIR` environment variable, that should be bound to a volume to survive Electric restarts. If you were using `CUBDB_FILE_PATH`, you should move that folder into a subdirectory named `shapes` and configure `STORAGE_DIR` to the previous directory.
