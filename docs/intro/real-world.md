---
title: Real-world apps
sidebar_position: 60
pagination_next: quickstart/index
---

import useBaseUrl from '@docusaurus/useBaseUrl'

So far, we've seen how local-first provides [instant reactivity](./local-first.md) and [realtime sync](./multi-user.md). We've looked under the hood at [conflict-free offline](./offline.md), [active-active replication](./active-active.md) and [dynamic sync controls](./sync-controls.md).

Bringing it all together and coming back to a high level, what kind of apps does ElectricSQL really work for? Are there examples and where do you go next?

## Postgres to local-first

ElectricSQL is designed to support relational applications which match a particular pattern. This pattern has a central, Postgres-based, backend application as a control plane or management system. You can then expose multiple local-first apps and interfaces on top of this, much as you would with traditional API-based architectures.

In this architecture, ElectricSQL replaces traditional APIs and state transfer protocols, like REST and GraphQL. You still define your data model [using your existing web framework](../usage/data-modelling/migrations.md), like Prisma, Phoenix or Rails -- any framework that handles migrations and works with Postgres.

You replace your server-side business logic with a local-first client app and background processing triggered by database events. And you codify your imperative authorization and validation logic into declarative security and sync rules.

## Example applications

You can see this pattern implemented, for example, in our LinearLite application.

LinearLite is a project management SaaS app, based on a simplified clone of Linear.app. It uses a membership-based block sync model where data is segmented by workspace. All users share the same local-first application interface.

<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/examples/basic">
        <img src={useBaseUrl('/img/examples/basic.svg')} loading="lazy"
            className="mt-2 -mb-1 sm:mt-3 sm:-mb-2 md:mt-4 w-8 sm:w-9 md:w-10"
        />
        <h3>
          Basic items
        </h3>
        <p className="text-small mb-2">
          Minimal demo app showing how to create and remove items
          from a list.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/examples/linear-lite">
        <img src={useBaseUrl('/img/examples/linear-lite.svg')} loading="lazy"
            className="mt-2 -mb-1 sm:mt-3 sm:-mb-2 md:mt-4 w-8 sm:w-9 md:w-10"
        />
        <h3>
          LinearLite
        </h3>
        <p className="text-small mb-2">
          Local-first project management app, based on a simplified
          Linear clone.
        </p>
      </a>
    </div>
  </div>
</div>

<!--

YumDash is a gig-economy, food delivery system that exposes three different local-first apps on top of the same backend management system. The backend management system is for the company that's operating the food delivery service (like a Just Eat or Uber Eats company). There's a local-first app for restaurant owners to manage orders. This is segmented by restaurant (i.e.: membership-based sync). The other two local-first interfaces are for the delivery driver and end-customer. These segment data by a combination of membership-based and location-based sync.

-->

<hr className="doc-divider" />

To dive in and start coding, see the [Quickstart](../quickstart/index.md).

For more detailed information, see the [Usage](../top-level-listings/usage.md) and [Integrations](../top-level-listings/integrations.md) guides. If you'd like to chat anything through, join the [community Discord](https://discord.electric-sql.com) and feel free to ask any questions there.
