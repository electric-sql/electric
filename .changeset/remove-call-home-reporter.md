---
"@core/sync-service": patch
"@core/electric-telemetry": patch
---

Remove the call-home reporter that sent anonymous usage data to checkpoint.electric-sql.com. Electric no longer phones home; the `ELECTRIC_USAGE_REPORTING` and `ELECTRIC_TELEMETRY_URL` environment variables are gone, along with the `call_home_telemetry?` and `telemetry_url` configuration options for embedded use.
