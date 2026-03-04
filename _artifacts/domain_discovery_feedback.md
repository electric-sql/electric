# Intent Meta Skill Feedback

## Domain Discovery

- What worked well: The phased approach (scan → interview → deep read → detail interview) produced comprehensive coverage. The failure mode extraction from source assertions and migration guides was particularly high-yield. The gap-targeted question templates helped surface maintainer knowledge efficiently.
- What was confusing or missing: The lightweight path criteria ("fewer than 5 client-facing skill areas") was ambiguous for Electric (9 skills but a focused library). Ended up using the full flow which worked fine. The instruction to read "every narrative guide" is impractical for libraries with extensive online-only docs.
- Suggestions for improvement: Add guidance for monorepos where skills span multiple packages but domain discovery is repo-wide. Clarify how to handle libraries where the main value is in composition with another library (Electric + TanStack DB).
- Overall rating: good

## Tree Generator

- What worked well: Clear decision framework for flat vs nested structure. The monorepo layout guidance (skills inside each package) was straightforward. The minimal library fast path correctly identified this as a flat-structure library.
- What was confusing or missing: The package assignment for skills that span multiple packages (e.g., deployment covers sync-service config but developers find it via the client package) could use more guidance. Defaulting to the primary client package worked fine here.
- Suggestions for improvement: Add guidance for when a skill's content is primarily about a server-side component but discovery happens through a client package.
- Overall rating: good

## Generate Skill

- What worked well: Clear body structure templates made it straightforward to write consistent skills. The checklist/audit alternative template for security skills produced a more useful output than the standard pattern would have. The 500-line budget was a good constraint that forced reference file extraction.
- What was confusing or missing: No guidance on how to handle skills that reference APIs from other packages (e.g., electric-new-feature references TanStack DB APIs). Unclear whether to include full code examples or just reference the other library's skills.
- Suggestions for improvement: Add guidance for composition skills that reference a companion library's API extensively (e.g., how much TanStack DB code to include in an Electric skill).
- Overall rating: good

## General Feedback

- The post-generation steps (validate, setup, update package.json files, add devDependency, copy shim, create labels) are presented as optional but they are REQUIRED for skills to actually ship with the npm package. They should be integrated into the scaffold flow, not listed as an afterthought.
- The `--shim` flag mentioned in scaffold output doesn't exist — `setup` does everything at once. The scaffold instructions should match the actual CLI API.

## Context (optional)

- Library: @electric-sql/client
- Repo: https://github.com/electric-sql/electric
- Docs: https://electric-sql.com/docs
- Notes: Monorepo with 4 client-facing packages. Primary composition target is TanStack DB (separate repo with its own skills).
