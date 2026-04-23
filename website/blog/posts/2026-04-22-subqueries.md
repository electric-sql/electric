---
title: 'Subqueries - complete access-control with Sync'
description: >-
  ...
excerpt: >-
  ...
authors: [rob]
image: /img/blog/subqueries/header.jpg
tags: [shapes, postgres-sync]
outline: [2, 3]
post: true
published: false
---

Electric syncs Postgres data into local apps. You declare a shape — a table and a WHERE clause — and Electric streams the matching rows, keeps them current, handles reconnection. Your app reads from a local store. No fetch logic, no loading states, no stale data. If you haven't seen the pitch: [sync replaces data fetching](/blog/2025/04/22/untangling-llm-spaghetti) and it's [how you build real-time, collaborative apps](/blog/2025/04/09/building-ai-apps-on-sync).

Subqueries extend shape WHERE clauses with relational logic. Sync rows where a membership exists, a role matches, a share is granted. Sync the line items for an invoice, the comments on an issue, the messages in a thread. Relational filtering defined in SQL, evaluated server-side, synced incrementally.

:::info
Subqueries are available on [Electric Cloud](/cloud) and are included in the [Pro, Scale, and Enterprise plans](/pricing).
:::


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


## Patterns

### Tenant scoping

Sync resources that belong to my workspace.

```sql
workspace_id IN (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = $1
)
```

Every member of the workspace gets the same resources. When someone joins, the resources sync in. When they leave, the resources sync out.

### Ownership + sharing

My files, plus files shared with me. Two paths to access in one shape.

```sql
owner_id = $1
OR id IN (
  SELECT document_id FROM document_shares
  WHERE shared_with = $1
)
```

Direct ownership is a column filter. Sharing is a subquery. OR combines them. When a share is granted or revoked, only that document moves.

### Hierarchical access

Tasks in projects belonging to my teams. Two levels of indirection, one WHERE clause.

```sql
project_id IN (
  SELECT id FROM projects WHERE team_id IN (
    SELECT team_id FROM team_members WHERE user_id = $1
  )
)
```

Nested subqueries follow the org hierarchy. When a user joins a team, they get all the tasks in all that team's projects.

### Role-scoped access

Billing data visible only to admins and billing managers.

```sql
org_id IN (
  SELECT org_id FROM org_members
  WHERE user_id = $1
  AND role IN ('admin', 'billing_manager')
)
```

The role filter narrows which memberships grant access. Different roles sync different data from the same shape definition.

### Project scoping

Sync comments for a specific project, traversing through tasks and issues.

```sql
issue_id IN (
  SELECT id FROM issues WHERE task_id IN (
    SELECT id FROM tasks WHERE project_id = $1
  )
)
```

The shape syncs all comments reachable from the project root. When a new task or issue is created under the project, its comments sync in automatically.

See the [WHERE&nbsp;clause docs](/docs/guides/shapes#where-clause) for the full reference on supported operators and subquery patterns.


## Incremental sync for all subquery expressions

With the release of Electric 1.6, subqueries we now support incremental sync for all subquery expressions, including complex boolean logic and nesting. This means you can write expressive shape definitions with subqueries, and Electric will efficiently sync only the affected rows when underlying data changes. 

<!-- The Venn diagram section. Why subqueries are now ready for real use.
     State what's true now — don't dwell on what was broken before.
     Short and punchy. -->

Shapes can be large — millions of rows. Expressive — subqueries with AND, OR, NOT, nesting, composite keys. And fast — incremental sync, only affected rows move.

This release makes all three work together. Complex boolean expressions over subqueries now sync incrementally. No tradeoff.

When a membership changes, a share is revoked, or a role is updated, the sync engine identifies exactly which rows are affected. Only those rows move in or out. No full resync, regardless of shape size or WHERE clause complexity.

<!-- ASSET: Venn diagram — large / fast / expressive, all three overlapping -->


## Get started

<!-- Lead with the TanStack integration example — this is what the reader
     will actually write. Then setup steps. -->

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

Subqueries are behind feature flags while we finalise the API. Enable them on your sync service:

```sh
ELECTRIC_FEATURE_FLAGS=allow_subqueries,tagged_subqueries
```

:::warning
Subquery support required a client protocol update. Make sure all your clients are on `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0` before upgrading the server. These packages have been available since April&nbsp;3rd.
:::

Subqueries will graduate from the feature flag and be enabled by default in a future release. The docs are being updated to reflect production-ready status.

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
