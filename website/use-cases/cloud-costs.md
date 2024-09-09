---
title: "Cloud costs"
description: >-
  Take the query workload off your database and the
  compute workload off your cloud.
image: /img/use-cases/scalability.png
outline: deep
case: true
homepage: true
homepage_order: 30
solves: "scaling"
benefits:
  - Simplifies your infra
  - Reduces your cloud bill
---

## Radically reduce your cloud bill

Most software today is built on a 3-tier web-service architecture. Front-end apps talk to backend services to fetch data and run business logic.

<figure>
  <img src="/img/use-cases/three-tier-architecture.png"
      alt="Diagramme illustrating 3-tier software architecture"
      style="margin: 0; width: 100%; max-width: 450px"
  />
</figure>

This means business logic executes on the cloud, which leads to high volumes of requests and database queries. This costs money to serve, in the form of compute and database query costs. Plus querying data in the cloud leads to large egress costs.

## Sync-engine architecture

Sync-engine architecture replaces data fetching, querying and egress from the cloud with sync into a local data store, local queries and minimal egress.

<figure>
  <img src="/img/use-cases/sync-engine-architecture.png"
      alt="Diagramme illustrating sync engine architecture"
      style="margin: 0; width: 100%; max-width: 450px"
  />
</figure>

This architecture changes the operational cost characteristics of your software:

- moving business logic onto the client device
- eliminating the request workload hitting the cloud
- minimising database query and egress costs
- avoiding SRE costs from high uptime

## How does Electric help?

Electric is a sync engine. You can use Electric to move to a sync engine architecture.

## Example

[Linear](https://linear.app), which is the world's most popular project management software, built their product on a sync-engine archicture. As a result, they've been able to run the whole of their European hosting on just two standard web servers. This has massively reduced their cloud bill.

<div class="embed-container">
  <iframe src="https://www.youtube-nocookie.com/embed/VLgmjzERT08"
      frameborder="0"
      allow="encrypted-media; picture-in-picture"
      allowfullscreen>
  </iframe>
</div>

## Next steps

Get in touch if you're interested in switching to a sync engine architecture to reduce your cloud costs.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/about/contact"
        text="Contact us"
        theme="brand"
    />
  </div>
</div>