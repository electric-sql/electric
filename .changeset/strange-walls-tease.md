---
"@core/sync-service": patch
---

Electric will now shut down and provide an error message if there is a critical error connecting to the database
such as the database or domain not existing.

The API will now return more helpful error messages if Electric is having issues connecting to the database.
