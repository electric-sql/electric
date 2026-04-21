---
title: '...'
description: >-
  ...
excerpt: >-
  ...
authors: [rob]
image: /img/blog/fluent-subqueries/header.jpg
tags: [release, postgres-sync, shapes]
outline: [2, 3]
post: true
published: false
---

<!-- TLDR opener — what shipped and why it matters. No setup, no preamble.
     Tone: confident, direct. This is the pitch. -->

Electric shapes now support fluent subqueries. This release adds AND, OR, NOT, and NOT&nbsp;IN for subquery WHERE&nbsp;clauses — all with incremental sync. Combined with existing support for nested subqueries and composite keys, you can now express real-world access-control logic directly in your shape definitions.

Before, anything more complicated than `x IN (SELECT ...)` handled subquery value changes with a full resync of the shape, making large shapes impractical. Now you can write the access-control and multi-tenant queries you'd naturally write in SQL. The sync engine handles them.

:::info
- [PR #4051](https://github.com/electric-sql/electric/pull/4051)
- Requires `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0`
- Feature flags: `ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries`
:::


## Before: one subquery, one shape

<!-- Context — brief orientation. Not a backstory, just enough to make the
     "what's new" land. Show the constraint clearly so the reader feels
     the relief when it lifts. 3 bullets max. -->

Electric has supported subquery filtering since mid-2025 — sync rows where a relationship exists in another table. But real access-control logic is rarely a single condition. You need tasks where I'm a project member *or* directly assigned. You need NOT&nbsp;IN to exclude.

Previously, combining subqueries with boolean operators triggered HTTP&nbsp;409 — full shape invalidation and resync from scratch. For large shapes, that killed the pattern.


## Fluent subqueries

<!-- What's shipping — the headline, then a showcase of patterns. This is
     where the post earns its name. Each example is a thing the reader can
     now do that they couldn't before. Show expressiveness through realistic
     examples, not abstraction.

     Author: expand each pattern into a short intro sentence + code block.
     Keep intros to one line — the code speaks for itself. -->

This release adds AND, OR, NOT, and NOT&nbsp;IN to subquery WHERE&nbsp;clauses. All sync incrementally — no more 409 resyncs when dependency rows change. Move-in and move-out is precise: when a user gains or loses access, only the affected rows sync in or out.

Here's what that unlocks:

### Access control with OR

<!-- The most common request — "sync tasks where I'm a member OR directly assigned" -->

Tasks where the current user is a project member or directly assigned:

```sql
project_id IN (
  SELECT project_id FROM project_members WHERE user_id = $1
)
OR assignee_id = $1
```

### Exclusion with NOT IN

<!-- Negative filtering — exclude rows based on a subquery relationship -->

Documents not in archived folders:

```sql
folder_id NOT IN (
  SELECT id FROM folders WHERE status = 'archived'
)
```

### Nested subqueries with boolean logic

<!-- Nested subqueries were already supported — the new part is combining
     them with AND/OR/NOT. Show a realistic example that uses both. -->

Nested subqueries were already supported, but lacked full expressiveness. Now you can combine them with boolean operators — tasks in projects belonging to my teams, excluding anything I've explicitly hidden:

```sql
project_id IN (
  SELECT id FROM projects WHERE team_id IN (
    SELECT team_id FROM team_members WHERE user_id = $1
  )
)
AND id NOT IN (
  SELECT task_id FROM hidden_tasks WHERE user_id = $1
)
```

### Composite keys with OR

<!-- Composite key subqueries were already supported — show them combined
     with OR to demonstrate how existing + new features compose. -->

Composite key subqueries already worked for tuple matching. Now you can combine them with boolean logic — documents where I have the right project role, or that are explicitly shared with me:

```sql
(project_id, role) IN (
  SELECT project_id, role FROM project_roles
  WHERE user_id = $1 AND role IN ('editor', 'admin')
)
OR id IN (
  SELECT document_id FROM document_shares
  WHERE shared_with = $1
)
```

### Mixed conditions

<!-- The kitchen-sink example — shows how all the pieces compose.
     This is the one to use in the "Get started" section as a full
     code sample. -->

Workspace member AND the document is either public, created by me, or shared with me:

```sql
workspace_id IN (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = $1
)
AND (
  visibility = 'public'
  OR created_by = $1
  OR id IN (
    SELECT document_id FROM document_shares
    WHERE shared_with = $1
  )
)
```

<!-- ASSET: consider an embedded tweet or Discord message showing community
     demand for this feature, if one exists -->

All of these sync incrementally. When any dependency changes — a membership added, a share revoked, a folder archived — only the affected rows move in or out.


## How it works

<!-- Brief technical paragraph — one key insight, not a deep dive.
     Readers who want depth can check the PR. -->

The client protocol now uses tags based on the DNF (Disjunctive Normal Form) decomposition of the WHERE&nbsp;clause. The sync service tracks exactly which conditions each row satisfies, so it can determine precisely which rows to move in or out when any dependency changes — without resorting to full invalidation.


## Get started

<!-- Practical steps. Show, don't tell. The reader should be able to
     try this from the post. -->

Update to the latest packages:

```sh
npm install @tanstack/db@latest @tanstack/electric-db-collection@latest
```

Enable the subquery feature flags on your sync service:

```sh
ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries
```

Then define shapes with fluent subqueries:

```ts
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createCollection } from '@tanstack/react-db'

const documentsCollection = createCollection(
  electricCollectionOptions({
    id: 'accessible-documents',
    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: 'documents',
        where: `
          workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = $1
          )
          AND (
            visibility = 'public'
            OR created_by = $1
            OR id IN (
              SELECT document_id FROM document_shares
              WHERE shared_with = $1
            )
          )
        `,
        params: { '1': currentUserId },
      },
    },
  })
)
```

See the [WHERE&nbsp;clause docs](/docs/guides/shapes#where-clauses) for the full reference on supported operators and subquery patterns.


## Coming next

- **WHERE&nbsp;clause optimization for OR** — optimizing how the sync service indexes and routes OR branches, so shapes with OR conditions perform even better at scale ([#4134](https://github.com/electric-sql/electric/pull/4134))

***

Links:

- [Docs: shapes and WHERE&nbsp;clauses](/docs/guides/shapes#where-clauses)
- [Electric Cloud](/cloud)
- [Discord community](https://discord.electric-sql.com)

<!-- DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING -->

<!--
## Meta

### Intent

- **What is this post about?** Electric's WHERE clauses for shapes are now
  fully expressive — subqueries with AND, OR, NOT, IN, NOT IN, nesting,
  composite keys, all with incremental sync.
- **What's interesting?** The constraint has been removed. Before, only bare
  `x IN (SELECT ...)` worked incrementally. Now you can write the
  access-control queries you'd naturally write in SQL.
- **Reader takeaway:** You can express real-world filtering logic in Electric
  shapes the way you'd naturally express it in SQL. The sync engine handles
  the complexity.
- **CTAs:** Update packages, enable feature flags, try fluent subqueries.
- **Authority:** We built it, it was our most requested feature.

### Title brief

"Fluent subqueries" is the anchor concept. Sentence case. Options:
- "Fluent subqueries for shapes"
- "Fluent subqueries"
- "Fluent subqueries now sync incrementally"

### Description brief

SEO target: Electric, subqueries, WHERE clauses, AND/OR/NOT, incremental
sync, shapes. Convey: you can now write complex access-control and
multi-tenant filtering with subqueries in any boolean combination, and
it all syncs incrementally.

### Excerpt brief

2-3 short sentences for the blog listing card. Key shift: from single
subquery support to full expressiveness. Match word count of other
post excerpts.

### Image prompt

Concept: flowing/branching SQL expressions or logic tree on dark background.
Brand colors: #D0BCFF purple, #00d2a0 green, #75fbfd cyan.
Aspect ratio: 16:9 (~1536x950px). Center-center composition.
Use /blog-image-brief for a detailed prompt if needed.

### Asset checklist

- [ ] 5 SQL code samples (inline) — access control OR, NOT IN, nested,
      composite keys, mixed conditions — TO CREATE during prose-up
- [ ] Full TypeScript code sample in Get started — TO CREATE during prose-up
- [x] Header image — copied from existing draft
- [ ] Community tweet/Discord message showing demand — TO FIND if available
- [x] PR #4051 link
- [x] WHERE clause docs link

### Open questions

- Is the existing header image still appropriate for the "fluent subqueries"
  framing, or should we generate a new one?
- Are there community tweets or Discord messages requesting this feature
  that would work as social proof?
- Should any of the SQL examples use different tables/domains for variety?

### Typesetting checklist

- [ ] Non-breaking spaces where appropriate (WHERE&nbsp;clause, NOT&nbsp;IN)
- [ ] Title uses sentence case
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells
-->
