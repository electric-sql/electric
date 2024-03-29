---
title: Conflict-free offline
sidebar_position: 30
---

import ConnectivityDemo from '!!raw-loader!@site/intro/src/demos/offline/connectivity.jsx'
import IntegrityDemo from '!!raw-loader!@site/intro/src/demos/offline/integrity.jsx'

As we've seen, first you [write to a local database](./local-first.md), then [data syncs in the background](./multi-user.md). This introduces the potential for different users to change the same data at the same time. These writes need to be handled consistently and without conflicts.

## Merging offline writes

Below, again we have two local-first demo apps with multi-user sync. This time, we've added a connectivity toggle. So you can switch the network on and off for each of the users.

<CodeBlock live={true} noInline={true} language="jsx">{
  ConnectivityDemo
}</CodeBlock>

Play around to verify the sync when connected. Then switch off the network in one or more of the apps. Play around with both to generate and stack up some changes. Then re-enable the network and see how they sync.

The first thing to note is that the changes sync and the apps are resilient to going in and out of connectivity. The second thing to note is how the apps always resolve to the same state.

## Preserving data integrity

We've seen above how offline writes sync resiliently without conflicts. But what about cases where concurrent writes could result in inconsistent data?

For example, the app below allows you to enroll players in tournaments. Drag the player icons into and out-of the tournaments to enroll and unenroll them. Use the add button to add a tournment and the little `x` button to delete them.

Now, what happens if one user enrolls a player in a tournament whilst another user concurrently deletes the same tournament?

<CodeBlock live={true} noInline={true} language="jsx">{
  IntegrityDemo
}</CodeBlock>

Try it out for yourself. Can you cause an integrity violation?

Ultimately, where you used to need a server to provide consistency and integrity guarantees, now you can use [CRDTs](../reference/consistency.md#crdts), [strong eventual consistency](../reference/consistency.md#tcc) and [Rich-CRDT techniques](../reference/consistency#rich-crdts). In the example above, we use a technique called compensations to ensure that the tournament is re-created if its deletion would lead to an integrity violation.

This is one of the techniques that allows ElectricSQL to support [existing relational data models](../usage/data-modelling/index.md) and provide drop-in local-first directly on Postgres.

<hr className="doc-divider" />

So that was conflict-free offline. Let's now really unlock the power of the system by diving into [active-active replication](./active-active.md) between Postgres and SQLite &raquo;
