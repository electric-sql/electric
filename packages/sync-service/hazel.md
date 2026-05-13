Hazel (stack_id = 80422006-…), Mon 08:00 UTC → now (~75h)

  ┌───────────────────────────────────────────────┬───────┐
  │                    Metric                     │ Value │
  ├───────────────────────────────────────────────┼───────┤
  │ Distinct WHERE clauses                        │ 9     │
  ├───────────────────────────────────────────────┼───────┤
  │ Distinct shape handles                        │ 13    │
  ├───────────────────────────────────────────────┼───────┤
  │ Total subquery occurrences                    │ 4     │
  ├───────────────────────────────────────────────┼───────┤
  │ Distinct subqueries (literal)                 │ 4     │
  ├───────────────────────────────────────────────┼───────┤
  │ Distinct subquery templates (UUIDs collapsed) │ 1     │
  └───────────────────────────────────────────────┴───────┘

  The single template:
  (SELECT "organizationId" FROM public.organization_members
   WHERE "userId" = '<uuid>'::uuid AND "deletedAt" IS NULL)

  Pattern of use

  Hazel only has 3 outer shape definitions:
  1. "userId" = '<uuid>'::uuid AND "deletedAt" IS NULL on organization_members — one per user (4 users seen)
  2. "deletedAt" IS NULL AND "organizationId" IN (SELECT … WHERE "userId" = '<uuid>') on organization_members — one per user (same 4 users)
  3. true on user_presence_status — one shape

  Inner-shape sharing is 1:1 here, not many-to-one. Each per-user inner subquery is referenced by exactly one outer shape (the user's own "find my orgs" shape). No nesting (subqueries are one level deep), no
  cohort fan-out across multiple outer shape definitions.

  So for hazel the SubqueryIndex RFC's memory savings would be modest — there's no per-cohort base view to amortize across many participants because each cohort would have only 1 participant. The structural
  complexity (nested subqueries, multiple outer shapes per inner subquery) that drove the autoarc analysis isn't present in hazel's workload.
