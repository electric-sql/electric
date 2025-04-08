---
"@core/sync-service": patch
---

Obfuscate database password during parsing to prevent its accidental leaking in logs.

When Electric is used in library mode, obfuscation by the parent application is
optional: Electric doesn't log the connection options until after it has
obfuscated the password.
