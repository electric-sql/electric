---
'@electric-sql/client': minor
---

Add bidirectional column mapping API for query filters with built-in snake_case ↔ camelCase support. Introduces `columnMapper` option to `ShapeStream` that handles both encoding (TypeScript → Database) for WHERE clauses and decoding (Database → TypeScript) for results. Includes `snakeCamelMapper()` helper for automatic snake_case/camelCase conversion and `createColumnMapper()` for custom mappings. The new API deprecates using `transformer` solely for column renaming, though `transformer` remains useful for value transformations like encryption.
