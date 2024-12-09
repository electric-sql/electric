---
"@electric-sql/client": patch
---

Use "get" instead of "has" for checking searchParams

Not all implementations of JS have the has(name, value) syntax e.g. Expo.
