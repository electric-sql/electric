---
title: '...'
description: >-
  ...
excerpt: >-
  ...
authors: [rob]
image: /img/blog/subqueries-in-where-clauses/header.jpg
tags: [release, postgres-sync, shapes]
outline: [2, 3]
post: true
published: false
---

<!-- TLDR — this IS the what and why. No preamble, no setup. -->

Electric now supports complex WHERE clauses with AND, OR, and NOT around subqueries — with incremental sync instead of full resyncs. The access-control and multi-tenant filtering patterns that production apps need now work efficiently at scale.

When a user gains access to a workspace, joins a project, or gets added to a team, only the affected rows sync in. No shape invalidation. No expensive full resync.

:::info
- [PR #4051](https://github.com/electric-sql/electric/pull/4051)
- Requires `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0`
:::


## Why subqueries matter

<!-- Brief orientation — not backstory. Just enough context for readers not already tracking this. -->

- Most real-world apps don't sync entire tables — they sync "the data this user is allowed to see"
- That may require filtering by relationships in other tables: "sync all meetings where the current user is a member"
- In SQL, that's a subquery in the WHERE clause: `id IN (SELECT meeting_id FROM members WHERE user_id = $1)`
- Electric has supported basic subquery filtering since mid-2025 — but combining subqueries with AND, OR, or NOT would trigger a full resync (409) on every change to the dependency tables, forcing the client to discard the shape and re-fetch from scratch


## What's new

<!-- Concrete capabilities. Each bullet = something the reader can now do that they couldn't before. -->

- **Boolean combinations of subqueries** — WHERE clauses with AND, OR, and NOT around subqueries now sync incrementally. No more 409 full resyncs when dependency rows change
- **Incremental move-in/out** — when a user gains or loses access (e.g., joins a workspace, gets added to a project), only the affected rows are synced — not the entire shape
- **Complex access-control patterns** — patterns like `user_id IN (SELECT ...) OR team_id IN (SELECT ...)` now just work

<!-- ASSET: code sample showing a realistic WHERE clause with AND/OR and subqueries.
     Good candidate: multi-tenant workspace pattern, e.g.,
     WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)
       AND project_id IN (SELECT project_id FROM project_access WHERE user_id = $1)
     Show as a shape definition, not raw SQL. -->

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

<!-- Show don't tell. The reader should be able to try this from the post. -->

- Update to the latest Electric sync service
- Update client packages: `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0`

<!-- ASSET: code sample — a complete shape definition using boolean combinations
     of subqueries. Show the shape config, not just the SQL.
     Could mirror the multi-tenant example from "What's new" but as runnable code. -->

- See the [WHERE clause docs](/docs/guides/shapes#where-clauses) for the full reference


## Coming next

<!-- Brief roadmap tease. Keep momentum. -->

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

## Title brief

Something direct and specific. Sentence case. Name the capability,
not the mechanism. Directions:
- "Subqueries in WHERE clauses now sync incrementally"
- "Complex WHERE clause filtering for real-world sync patterns"
- "Full subquery support in shape WHERE clauses"
Avoid generic "announcing" framing.

## Description brief (SEO)

Should convey: Electric now handles AND/OR/NOT combinations of subqueries
in shape WHERE clauses with incremental updates instead of full resyncs.
Enables multi-tenant and access-control sync patterns at scale. No HTML.

## Excerpt brief

2-3 short sentences for the blog listing card. Cover: what shipped, why
it matters, who benefits. Match length of existing post excerpts (~2 lines).

## Image prompt

Dark background, abstract visualization of data filtering or boolean
branching — AND/OR/NOT nodes with data rows flowing through selectively.
Brand colors: purple (#D0BCFF), green (#00d2a0), cyan (#75fbfd).
Center-center composition. 16:9 aspect ratio, ~1536x950px.
Use /blog-image-brief for a detailed prompt.

## Asset checklist

- [ ] Code sample: realistic WHERE clause with AND/OR + subqueries
      (shape definition, not raw SQL) — NEEDS CREATING
- [ ] Code sample: complete "get started" example — NEEDS CREATING
- [ ] User quotes from GitHub issues (get permission) — NEEDS SELECTION
- [ ] Header image — NEEDS CREATING
- [ ] Confirm exact sync service version number for this release

## Open questions

- Author key: "rob" needs adding to website/data/blog/authors.yaml
  (currently using "thruflo" as placeholder)
- Which user quotes to include as social proof? Candidates: @jbingen
  (#3769), @ibarakaiev (#4004), @dsanmart (#3651), #3256
- What code sample best demonstrates the feature? Multi-tenant workspace
  pattern? Team-based access control?
- Confirm exact version numbers for the sync service release

## Typesetting checklist

- [ ] Use non-breaking spaces and hyphens where appropriate
- [ ] Title uses sentence case, not Title Case
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells: "it's worth noting", "importantly", "in conclusion",
      "let's dive in", "at its core", "in today's landscape"
-->
