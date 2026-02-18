---
'@electric-sql/client': patch
---

Add runtime validation for `columnMapper` option to catch common mistake of passing the factory function instead of calling it. Provides helpful error messages like "Did you forget to call snakeCamelMapper()?" when users pass `snakeCamelMapper` instead of `snakeCamelMapper()`.
