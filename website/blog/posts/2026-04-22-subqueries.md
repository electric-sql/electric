---
title: Relational access control for sync with subqueries
description: >-
  Electric now supports subqueries in shape WHERE clauses. Define access-control logic in SQL and Electric syncs only the matching rows to each client, incrementally.
excerpt: >-
  Subqueries extend shape WHERE clauses with relational logic. Define who sees what in SQL — membership checks, role lookups, shared documents — and Electric syncs only the matching rows, incrementally.
authors: [rob]
image: /img/blog/subqueries/header.jpg
tags: [shapes, postgres-sync, release]
outline: [2, 3]
post: true
published: false
---

With Electric&nbsp;1.6, subqueries in shape WHERE clauses are production-ready. Complex expressions now sync incrementally — no tradeoff between expressiveness and performance.

Sync makes apps fast, resilient, and collaborative. You declare a shape — a table and a WHERE clause — and Electric streams the matching rows into your app, keeps them current, handles reconnection. No fetch logic, no loading states, no stale data. If you haven't seen the pitch: [sync replaces data fetching](/blog/2025/04/22/untangling-llm-spaghetti) and it's [how you build real-time, collaborative apps](/blog/2025/04/09/building-ai-apps-on-sync).

Subqueries extend shape WHERE clauses with relational logic. Sync rows where a membership exists, a role matches, a share is granted. Sync the line items for an invoice, the comments on an issue, the messages in a thread. Relational filtering defined in SQL, evaluated server-side, synced incrementally.


## Shapes and relational data

Shapes are the primitive for declaring what data syncs to each client. A table and a WHERE clause. Declare the subset, sync it. This makes shapes fast to sync and means users only have access to the data they should see.

But real data is relational. Access control depends on memberships, roles, and shares in other tables. Hierarchical data — invoice line items, issue comments, thread messages — lives in child tables linked by foreign keys. "Sync tasks where this user is a project member", "sync the items for this invoice" — the data you need to filter on lives in a different table. Column filters can't reach it.

You need relational logic in your shape WHERE clause.


## Subqueries

A subquery in a shape WHERE clause filters rows based on data in another table. You write SQL. The sync engine evaluates it server-side and syncs only the matching rows to each client.

```sql
workspace_id IN (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = $1
)
```

Parameters (`$1`) are bound per client — the same shape definition serves different data to different users.

When the underlying data changes — a membership added, a user removed — the sync engine re-evaluates and moves only the affected rows in or out. No full resync, no refetch.

Subqueries can be combined with OR. My files, plus files shared with me — two paths to access in one shape:

```sql
owner_id = $1
OR id IN (
  SELECT document_id FROM document_shares
  WHERE shared_with = $1
)
```

Direct ownership is a column filter. Sharing is a subquery. OR combines them. When a share is granted or revoked, only that document moves.

Subqueries can also be nested. Sync comments for a specific project, traversing through tasks and issues:

```sql
issue_id IN (
  SELECT id FROM issues WHERE task_id IN (
    SELECT id FROM tasks WHERE project_id = $1
  )
)
```

The shape syncs all comments reachable from the project root. When a new task or issue is created under the project, its comments sync in automatically.

See the [WHERE&nbsp;clause docs](/docs/guides/shapes#where-clause) for the full reference on supported operators and subquery patterns.

:::info
Subqueries are available on [Electric Cloud](/cloud) and are included in the [Pro, Scale, and Enterprise plans](/pricing).
:::


## Production-ready in Electric&nbsp;1.6

We've kept subqueries experimental while we built out the sync engine support. With Electric&nbsp;1.6, they're production-ready.

Before 1.6, subqueries worked with complex SQL expressions, large shapes, and low-latency updates — but you couldn't have all three at the same time. Shapes with subqueries combined with AND/OR/NOT would trigger a full resync on subquery value changes, which for a large dataset would cause a noticeable delay.

With 1.6, the sync engine incrementally syncs only the affected rows, even for complex subquery expressions. No more tradeoff between expressiveness and performance.

We've also optimised how OR expressions are evaluated against the replication stream. Previously, processing time scaled with the number of active shapes. Now it's constant — adding more shapes doesn't slow down replication processing. All the SQL expressions mentioned in this article are now optimised — see the docs for the full list of supported expressions.

We've battle-tested subqueries in our test environments and in production and are confident in their performance and reliability.


## Get started

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

Subqueries are behind a feature flag while we ensure all clients have updated to the new protocol. Enable them on your sync service:

```sh
ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries
```

:::warning
Subquery with complex expression support in Electric&nbsp;1.6 required a [client protocol update](https://github.com/electric-sql/electric/blob/main/packages/sync-service/CHANGELOG.md). Make sure all your clients are on `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0` before upgrading the server. These packages have been available since April&nbsp;3rd.
:::

Once clients have migrated to the updated protocol, the feature flag will be removed and subqueries will be enabled by default.

See the [WHERE&nbsp;clause docs](/docs/guides/shapes#where-clause) for the full reference.

***

[Docs](/docs/guides/shapes#where-clause) · [Cloud](/cloud) · [Discord](https://discord.electric-sql.com)


<!-- DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING -->
<!--
==========================================================
META
==========================================================

## Intent

- **What is this post about?** Electric supports subqueries in shape
  WHERE clauses. Define who sees what with SQL — membership checks,
  role lookups, exclusions — and Electric syncs the right rows to each
  client, incrementally.
- **What's interesting about it?** Shapes are how you declare what data
  syncs. Subqueries make shapes expressive enough to handle real
  access-control patterns. And with this release, they're ready for
  widescale use — complex expressions now sync incrementally, so
  there's no tradeoff between expressiveness and performance.
- **Reader takeaway:** "I can write real access-control logic directly
  in my shape WHERE clauses, and Electric handles the sync —
  incrementally, even for complex expressions."
- **CTAs:** Update packages, enable feature flags, try it. Docs for
  full reference.
- **Why us:** We built it. This is the culmination of the subquery
  work in the sync engine.

## Title brief

Should name subqueries and connect to sync/access control. Sentence
case. Direction: "Relational access control for sync with subqueries"
or similar — leads with the concept, explains the mechanism. "Subqueries"
is meaningful to enough of the audience to include, but pair it with
a plain-language framing for readers who don't know the term.

## Description brief

For SEO. Mention: subqueries, shape WHERE clauses, access control,
incremental sync. One or two sentences, no HTML.

## Excerpt brief

For the blog listing card. Max 3 short sentences. Land the concept
(subqueries in shapes) and the benefit (relational access control
with incremental sync). Match word length of existing post excerpts.

## Image prompt

Dark background. Abstract representation of data flowing through a
filter with relational connections — like a graph or tree narrowing
to a subset. Brand colours: #D0BCFF (purple), #00d2a0 (green),
#75fbfd (cyan). 16:9, ~1536x950px, centre-centre composition.
Use /blog-image-brief for a detailed prompt.

## Asset checklist

- [ ] Header image (needs creating)
- [ ] Venn diagram: large / fast / expressive (needs creating — SVG or image)
- [x] SQL code blocks (in outline)
- [x] TypeScript code block (in outline)
- [x] Links to existing blog posts (untangling LLM spaghetti, building AI apps on sync)

## Open questions

- Venn diagram: simple SVG inline, or a designed image asset?
- Any social proof / community quotes to include?
- Valter: docs update to remove "experimental" — happening in a separate PR

## Typesetting checklist

- [ ] Non-breaking spaces where appropriate (WHERE clauses, version numbers)
- [ ] Sentence case on title
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells: "it's worth noting", "importantly", "in conclusion",
      "let's dive in", "at its core", "in today's landscape"

==========================================================
-->
