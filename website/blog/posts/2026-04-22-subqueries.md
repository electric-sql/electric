---
title: Subqueries — making sync work in practice
description: >-
  Subqueries let Electric shapes express relational filtering in SQL.
  Electric 1.6 keeps complex AND/OR/NOT expressions incremental too, so
  large shapes stay fast.
excerpt: >-
  Sync only works in real apps if it can follow relationships.
  Subqueries let Electric express relational filters for each user in SQL,
  and Electric 1.6 keeps complex expressions incremental too.
authors: [rob]
image: /img/blog/subqueries/header.jpg
tags: [shapes, postgres-sync, release]
outline: [2, 3]
post: true
published: true
---

Sync is what makes apps feel instant. The data is already there when a screen renders. Another user changes something and your UI stays current. You can refresh, reconnect, switch devices, and keep going.

That is the broad pitch. We have written more about how [sync replaces data fetching](/blog/2025/04/22/untangling-llm-spaghetti) and why it is the right foundation for [collaborative, real-time apps](/blog/2025/04/09/building-ai-apps-on-sync).

But there is a more practical question underneath all of it:

Which rows should this client actually receive?

In simple demos, a column filter is enough. In real systems, the rule usually lives in other tables. A document is visible because you own it, or because it was shared with you, or because you belong to the workspace that contains it. Comments sync because their issue belongs to a project you can access. Invoice line items sync because their parent invoice does.

This is where subqueries matter.

## Query-driven sync

Shapes are Electric's primitive for partial replication: a table and a `WHERE` clause. Define the subset once and Electric keeps that subset synced.

For flat cases, the filter is simple:

```sql
owner_id = $1
```

And here is how that looks in TanStack DB:

```ts
const documentsCollection = createCollection(
  electricCollectionOptions({
    id: 'my-documents',
    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: 'documents',
        where: 'owner_id = $1',
        params: { '1': currentUserId },
      },
    },
  })
)
```

Parameters (`$1`) are bound per client, so the same shape definition can serve different data to different users.

But real apps do not stay flat for long. Access control, tenant membership, and parent-child data all pull in related tables. Subqueries let you express those rules directly in SQL.

Sync documents for workspaces this user belongs to:

```sql
workspace_id IN (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = $1
)
```


You can combine relational checks with ordinary predicates. For example, sync documents that I own, plus documents shared with me:

```sql
owner_id = $1
OR id IN (
  SELECT document_id FROM document_shares
  WHERE shared_with = $1
)
```

You can also traverse multiple hops. Sync comments for a project by walking from comments to issues to tasks:

```sql
issue_id IN (
  SELECT id FROM issues WHERE task_id IN (
    SELECT id FROM tasks WHERE project_id = $1
  )
)
```

This is mundane SQL. That is the point.

The rule stays close to the data, where you already reason about memberships, shares, and relationships. Electric evaluates it server-side and keeps only the matching rows on each client.

See the [WHERE clause docs](/docs/guides/shapes#where-clause) for the full reference on supported operators and subquery patterns.

:::info
Subqueries are available on [Electric Cloud](/cloud) and are included in the [Pro, Scale, and Enterprise plans](/pricing).
:::

## Why this matters

The interesting part of sync is not a nicer `fetch()`. It is what you get once the right data is already local: live UIs, collaboration, resilient apps, instant navigation, fewer loading states.

But none of that survives contact with production unless sync can follow your actual data model. The moment you have shared documents, org membership, private projects, child records, or exclusions, a simple column filter stops being enough.

Subqueries are what make shapes fit real applications. They let you describe who can see a row, which child rows come along with a parent, how multiple access paths compose, and how exclusions or overrides work.

## What changed in Electric 1.6

Subqueries are not new. We have supported them for a while, behind feature flags, and they have already been battle tested by customers in production.

Electric 1.6 is the release that closes one of the last awkward cases.

Subqueries already supported incremental sync for simple expressions. Complex expressions using `AND`, `OR`, and `NOT` also worked, but when the subquery result changed Electric could fall back to a full resync. On small shapes you might never notice. On large ones you would feel it as lag between a write and the UI catching up.

With 1.6, those complex expressions stay incremental too. When memberships change, shares are granted, or related rows move in or out of scope, Electric now syncs only the affected rows. Large shapes keep the low-latency behavior that makes sync useful in the first place.

That is why we now consider subqueries suitable for general use.

This release also includes a client protocol update needed for the new incremental behavior. The feature flags are unchanged for now and we will remove them once we are confident clients have moved onto the newer protocol.

## Using it now

Here is the shared-documents example wired into a TanStack DB collection:

```ts
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createCollection } from '@tanstack/react-db'

const documentsCollection = createCollection(
  electricCollectionOptions({
    id: 'my-documents',
    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: 'documents',
        where: `
          owner_id = $1
          OR id IN (
            SELECT document_id FROM document_shares
            WHERE shared_with = $1
          )
        `,
        params: { '1': currentUserId },
      },
    },
  })
)
```

Update to the latest packages:

```sh
npm install @tanstack/db@latest @tanstack/electric-db-collection@latest
```

Subqueries remain behind the same feature flags as before:

```sh
ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries
```

:::warning
Incremental sync for complex subquery expressions in Electric 1.6 requires a client protocol update. Make sure all your clients are on `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0` before upgrading the server. Those versions have been available since April 3, 2026.
:::

If you were waiting for shapes to handle more realistic access-control logic without giving up the fast path, this is the point to try it.

See the [WHERE clause docs](/docs/guides/shapes#where-clause) for the full reference.

***

[Docs](/docs/guides/shapes#where-clause) · [Cloud](/cloud) · [Discord](https://discord.electric-sql.com)
