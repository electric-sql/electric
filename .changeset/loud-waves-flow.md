---
"electric-sql": patch
"create-electric-app": patch
---

- Fix generator not cleaning up temporary migrations folder on error.
- Add --debug flag to generator for option to retain migrations folder on error for inspection.
- Add temporary migration folder to gitignore in starter template
