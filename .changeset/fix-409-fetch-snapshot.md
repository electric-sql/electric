---
'@electric-sql/client': patch
---

Fix 409 must-refetch error handling in fetchSnapshot. The method now correctly catches FetchError exceptions thrown by the fetch wrapper chain, matching the pattern used by the main request loop.
