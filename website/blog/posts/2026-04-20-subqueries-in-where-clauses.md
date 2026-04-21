---
title: 'Subqueries with AND, OR, NOT now sync incrementally'
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

Electric now supports incremental sync for complex WHERE&nbsp;clauses with subqueries combined with AND, OR, and NOT. The access-control and multi-tenant filtering patterns that production apps need now work efficiently at scale.

When a user gains access to a workspace, joins a project, or gets added to a team, only the affected rows sync in. No shape invalidation. No expensive full resync.

:::info
- [PR #4051](https://github.com/electric-sql/electric/pull/4051)
- Requires `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0`
:::


## Why subqueries matter

Most real-world apps don't sync entire tables. They sync the data a specific user is allowed to see. That may require filtering by relationships in other tables — "sync all tasks where the current user is a member of the project."

In SQL, that's a subquery in the WHERE&nbsp;clause:

```sql
id IN (SELECT task_id FROM project_members WHERE user_id = $1)
```

Electric has supported basic subquery filtering since mid-2025. But real access-control logic is rarely a single condition. You might need tasks where the user is a project member *or* where the task is directly assigned to them. [Skip to "Get started"](#get-started) if you just want to try it.

```sql
project_id IN (SELECT project_id FROM project_members WHERE user_id = $1)
  OR assignee_id = $1
```

Previously, combining subqueries with AND, OR, or NOT would trigger a full resync (HTTP&nbsp;409) on every change to the dependency tables. The client had to discard the entire shape and re-fetch from scratch. For large shapes, that was a dealbreaker.


## What's new

**Boolean combinations of subqueries now sync incrementally.** WHERE&nbsp;clauses with AND, OR, and NOT around subqueries no longer trigger 409 full resyncs when dependency rows change.

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

This has been one of our most requested features — the intersection of subqueries and boolean logic is where most real-world access-control patterns live.


## How it works

To support arbitrary boolean expressions, we updated the client protocol to use tags based on the DNF (Disjunctive Normal Form) decomposition of the WHERE&nbsp;clause. This lets the sync service track exactly which conditions each row satisfies, so it can determine precisely which rows to move in or out when any dependency changes — without resorting to full invalidation.


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

See the [WHERE&nbsp;clause docs](/docs/guides/shapes#where-clauses) for the full reference on supported operators and subquery patterns.


## Coming next

- **WHERE&nbsp;clause optimization for OR** — we're optimizing how the sync service indexes and routes OR branches, so shapes with OR conditions perform even better at scale ([#4134](https://github.com/electric-sql/electric/pull/4134))

***

Links:

- [Docs: shapes and WHERE&nbsp;clauses](/docs/guides/shapes#where-clauses)
- [Electric Cloud](/cloud)
- [Discord community](https://discord.electric-sql.com)
