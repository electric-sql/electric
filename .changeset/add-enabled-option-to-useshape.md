---
"@electric-sql/react": minor
---

Add `enabled` option to `useShape` hook that allows conditionally disabling shape synchronization. When `enabled` is `false`, the hook returns an empty array as data and skips creating the underlying shape. The return type is now a discriminating union with an `isEnabled` flag, providing full type safety while maintaining backwards compatibility.
