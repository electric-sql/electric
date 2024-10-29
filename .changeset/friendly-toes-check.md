---
"@electric-sql/client": minor
"@electric-sql/react": patch
---

- Implement `rows` and `currentRows` getters on `Shape` interface for easier data access.
- [BREAKING] Rename `valueSync` getter on `Shape` to `currentValue` for clarity and consistency.
- [BREAKING] Change `subscribe` API on `Shape` to accept callbacks with signature `({ rows: T[], value: Map<string, T> }) => void`
