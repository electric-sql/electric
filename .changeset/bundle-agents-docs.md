---
"@electric-ax/agents": patch
---

Bundle Electric Agents documentation with the package so Horton can search docs without an external docs directory. Copies 39 markdown files from the docs site into `packages/agents/docs/` and updates `resolveDocsRoot` to find them relative to the module directory in both development and production builds.
