---
'@core/sync-service': patch
'@electric-sql/client': patch
---

Fix subset\_\_params to use constant parameter name for proxy configurations

Changed subset**params from deepObject style (subset**params[1], subset**params[2]) to JSON serialization (subset**params={"1":"value1","2":"value2"}). This allows proxy configurations to match the constant parameter name "subset\_\_params" in ELECTRIC_PROTOCOL_QUERY_PARAMS without needing dynamic pattern matching.
