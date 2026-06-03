---
"@electric-ax/agents-server": patch
"@electric-ax/agents-runtime": patch
"@electric-ax/agents": patch
---

Add owner-default agents-server permissions with type-level spawn grants, entity grants, effective permission materialization, principal-scoped entity observation streams, shared-state access links, runtime registration permission grants, and default user spawn grants for built-in Horton and Worker types.

Existing entity observation bridges are rebuilt after upgrade because pre-permission bridge rows do not include principal attribution.

Entity `manage` grants participate in read visibility, entity-type `manage` grants participate in spawn visibility, and broad parented spawn-time grants require `manage` on the parent.
