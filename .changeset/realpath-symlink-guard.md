---
'@electric-ax/agents-runtime': patch
---

The built-in `read`, `write`, and `edit` tools now reject paths whose realpath resolves outside the working directory. Previously the cwd guard was a string prefix check on the un-resolved path, which followed symlinks transparently — a symlink at `<cwd>/link.txt` pointing to `/etc/hostname` was readable, and a symlinked directory could redirect writes outside the workspace (CVE-2025-53109/53110 class). Intra-workspace symlinks (pnpm `.pnpm` trees, etc.) keep working. For non-existent write/edit targets the guard realpaths the deepest existing ancestor instead. Known gap: hardlinks across the cwd boundary still bypass; a proper fix requires a sandbox.
