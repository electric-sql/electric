---
title: 'Expressive subqueries'
description: >-
  Add AND, OR, NOT, and NOT IN operators to Electric shape subquery WHERE clauses. All sync incrementally — only affected rows move in or out.
excerpt: >-
  Electric shapes now support AND, OR, NOT, and NOT IN in subquery WHERE clauses — all with incremental sync. Express real access-control logic directly in shape definitions.
authors: [rob]
image: /img/blog/expressive-subqueries/header.jpg
tags: [release, postgres-sync, shapes]
outline: [2, 3]
post: true
published: true
---

Electric 1.6 adds incremental sync for AND, OR, NOT, and NOT&nbsp;IN in subquery WHERE&nbsp;clauses. No more full resyncs when dependency rows change.


## Before

Electric has supported subquery filtering since mid-2025 — sync rows where a relationship exists in another table. But real access-control queries combine multiple conditions. You need orders where the customer is in my region *and* the delivery is pending. You need tasks where I'm a project member *or* directly assigned. You need NOT&nbsp;IN to exclude.

Previously, combining subqueries with boolean operators triggered full shape invalidation and resync from scratch whenever the subquery values changed. For large shapes, that meant waiting for the entire dataset to re-download before the update appeared.


## Expressive subqueries

This release adds AND, OR, NOT, and NOT&nbsp;IN to subquery WHERE&nbsp;clauses. All sync incrementally — no more resyncs when dependency rows change. When a user gains or loses access, only the affected rows sync in or out.

### Subquery with AND

Orders where the customer is in my region and the delivery is pending:

```sql
customer_id IN (
  SELECT id FROM customers WHERE region_id = $1
)
AND delivery_status = 'pending'
```

### Access control with OR

Tasks where the current user is a project member or directly assigned:

```sql
project_id IN (
  SELECT project_id FROM project_members WHERE user_id = $1
)
OR assignee_id = $1
```

### Exclusion with NOT IN

Documents not in archived folders:

```sql
folder_id NOT IN (
  SELECT id FROM folders WHERE status = 'archived'
)
```

### Nested subqueries with boolean logic

Nested subqueries were already supported, but couldn't be combined with AND, OR, or NOT. Now they can — tasks in projects belonging to my teams, excluding anything I've explicitly hidden:

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

Composite key subqueries work for tuple matching — and now support boolean logic too. Documents where I have the right project role, or that are explicitly shared with me:

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

When any dependency changes — a membership added, a share revoked, a folder archived — only the affected rows move in or out of the shape.


## Get started

Update to the latest packages:

```sh
npm install @tanstack/db@latest @tanstack/electric-db-collection@latest
```

Subquery support is behind feature flags while we validate the API. Enable them on your sync service:

```sh
ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries
```

:::warning
The `tagged_subqueries` flag requires a client protocol update. The new server is not compatible with older clients — make sure all your clients are on `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0` before upgrading the server. These packages have been available since April&nbsp;3rd.
:::

:::info
[PR #4051](https://github.com/electric-sql/electric/pull/4051)
:::

Then define shapes with expressive subqueries:

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

See the [WHERE&nbsp;clause docs](/docs/guides/shapes#where-clause) for the full reference on supported operators and subquery patterns.
