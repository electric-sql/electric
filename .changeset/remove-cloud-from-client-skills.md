---
'@electric-sql/client': patch
---

Remove Electric Cloud references from the bundled agent skills. The deployment skill no longer describes a Cloud deployment path, and the proxy examples authenticate with `ELECTRIC_SECRET` instead of the Cloud `source_id`/source secret credentials.
