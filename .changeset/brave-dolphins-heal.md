---
'@core/sync-service': patch
'@electric-sql/client': patch
---

Fix subset__params to use constant parameter name for proxy configurations

Changed subset__params from deepObject style (subset__params[1], subset__params[2]) to JSON serialization (subset__params={"1":"value1","2":"value2"}). This allows proxy configurations to match the constant parameter name "subset__params" in ELECTRIC_PROTOCOL_QUERY_PARAMS without needing dynamic pattern matching.
