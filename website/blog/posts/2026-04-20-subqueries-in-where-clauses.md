---
title: 'Subqueries in WHERE clauses now sync incrementally'
description: >-
  Electric now handles AND, OR, and NOT combinations of subqueries in shape
  WHERE clauses with incremental updates instead of full resyncs. Multi-tenant
  and access-control sync patterns now work efficiently at scale.
excerpt: >-
  Shape WHERE clauses with AND, OR, and NOT around subqueries now sync
  incrementally. No more full resyncs when access-control relationships
  change.
authors: [rob]
image: /img/blog/subqueries-in-where-clauses/header.jpg
tags: [release, postgres-sync, shapes]
outline: [2, 3]
post: true
published: false
---

Electric now supports complex WHERE clauses with AND, OR, and NOT around subqueries — with incremental sync instead of full resyncs. The access-control and multi-tenant filtering patterns that production apps need now work efficiently at scale.

When a user gains access to a workspace, joins a project, or gets added to a team, only the affected rows sync in. No shape invalidation. No expensive full resync.

:::info
- [PR #4051](https://github.com/electric-sql/electric/pull/4051)
- Requires `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0`
:::


## Why subqueries matter

Most real-world apps don't sync entire tables. They sync the data a specific user is allowed to see. That may require filtering by relationships in other tables — "sync all tasks where the current user is a member of the project."

In SQL, that's a subquery in the WHERE clause:

```sql
id IN (SELECT task_id FROM project_members WHERE user_id = $1)
```

Electric has supported basic subquery filtering since mid-2025. But real access-control logic is rarely a single condition. You might need tasks where the user is a project member *or* where the task is directly assigned to them:

```sql
project_id IN (SELECT project_id FROM project_members WHERE user_id = $1)
  OR assignee_id = $1
```

Previously, combining subqueries with AND, OR, or NOT would trigger a full resync (HTTP 409) on every change to the dependency tables. The client had to discard the entire shape and re-fetch from scratch. For large shapes, that was a dealbreaker.


## What's new

**Boolean combinations of subqueries now sync incrementally.** WHERE clauses with AND, OR, and NOT around subqueries no longer trigger 409 full resyncs when dependency rows change.

**Move-in and move-out is incremental.** When a user gains or loses access — joins a workspace, gets added to a project, loses a team membership — only the affected rows sync in or out. The rest of the shape stays untouched.

**Complex access-control patterns just work.** Patterns like this are now fully supported with live incremental sync:

```ts
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createCollection } from '@tanstack/react-db'

const tasksCollection = createCollection(
  electricCollectionOptions({
    id: 'my-tasks',
    shapeOptions: {
      url: 'http://localhost:3000/v1/shape',
      params: {
        table: 'tasks',
        where: `
          project_id IN (
            SELECT project_id FROM project_members WHERE user_id = $1
          )
          OR assignee_id = $1
        `,
        params: { '1': currentUserId },
      },
    },
  })
)
```

This syncs all tasks where the current user is either a project member or directly assigned — and keeps the shape live as memberships and assignments change.

<!-- SOCIAL PROOF: pull quotes from GitHub issues — users who hit this limitation
     in production apps.

     Candidates:
     - @jbingen (#3769): multi-tenant workspace app where new members joining
       didn't trigger sync updates for existing members
     - @ibarakaiev (#4004): team-based access control with CASCADE deletes
       not syncing correctly — includes a full reproduction repo
     - @dsanmart (#3651): React Native messaging app needing sliding-window
       sync of recent activity, pointed to subqueries as the solution
     - Issue #3256: user spent "several days debugging" frequent 409 resyncs,
       described as "a very noticeable performance problem"

     Ask permission before quoting. Embed as blockquotes with attribution. -->


## Get started

Update to the latest Electric sync service and client packages:

```sh
npm install @tanstack/db@latest @tanstack/electric-db-collection@latest
```

Make sure you have the subquery feature flags enabled:

```sh
ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries
```

Then define your shapes with boolean combinations of subqueries:

```ts
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

This syncs documents where the user is a workspace member AND the document is either public, created by them, or explicitly shared with them. When any of these relationships change — a new share is added, a user joins a workspace, a document's visibility changes — only the affected rows move in or out.

See the [WHERE clause docs](/docs/guides/shapes#where-clauses) for the full reference on supported operators and subquery patterns.


## Coming next

- **WHERE clause optimisation for OR** — we're optimising how the sync service indexes and routes OR branches, so shapes with OR conditions perform even better at scale ([#4134](https://github.com/electric-sql/electric/pull/4134))


***

Next steps:

- [Docs: shapes and WHERE clauses](/docs/guides/shapes#where-clauses)
- [Electric Cloud](/cloud)
- [Discord community](https://discord.electric-sql.com)


<!-- ============================================================
     META — delete everything below this line before publishing
     ============================================================ -->

<!--
## Intent

- **What is this post about?** Electric now handles complex WHERE clauses
  with AND/OR/NOT around subqueries incrementally, eliminating the expensive
  full resyncs that made real-world access-control patterns painful.
- **What's interesting about it?** The most common real-world sync pattern
  is "show me the data I'm allowed to see" — filtering by relationships
  in other tables. This requires subqueries in WHERE clauses, and now
  Electric handles complex boolean combinations of them with incremental
  updates instead of full resyncs. This unlocks the access-control and
  multi-tenant patterns that production apps need.
- **What's the reader takeaway?** Electric can now handle the WHERE clause
  patterns that real applications actually need — multi-tenant filtering,
  access control, team membership — without performance cliffs. If you
  held off because subquery support was limited, it's time to look again.
- **What are the CTAs?** Try it out, check the docs, join Discord.
- **Why us?** We built it. This is the team that implemented the subquery
  infrastructure — DNF planning, splice handling, incremental move-in/out
  tracking — working through 19+ issues from real users hitting these
  limitations in production.

## Open questions

- Author key: "rob" needs adding to website/data/blog/authors.yaml
- Which user quotes to include as social proof? Candidates: @jbingen
  (#3769), @ibarakaiev (#4004), @dsanmart (#3651), #3256
- Confirm exact version numbers for the sync service release
- Are the feature flags still required or is this enabled by default now?

## Asset checklist

- [x] Code sample: realistic WHERE clause with AND/OR + subqueries
- [x] Code sample: complete "get started" example
- [ ] User quotes from GitHub issues (get permission)
- [ ] Header image — use /blog-image-brief for detailed prompt
- [ ] Confirm exact sync service version number

## Typesetting checklist

- [ ] Use non-breaking spaces and hyphens where appropriate
- [ ] Title uses sentence case, not Title Case
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells
-->
