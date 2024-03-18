---
title: Local-first
description: >-
  What is local-first and is ElectricSQL a fully local-first system?
---

Electric self-describes as an open source system for developing local-first software. Local-first is a term coined by Martin Kleppmann, Adam Wiggins, Peter van Hardenberg and Mark McGranaghan in [their 2019 manifesto](https://www.inkandswitch.com/local-first/).

The motivation behind the manifesto is to enable both online collaboration and data ownership. It defines seven ideals, including the network being optional and users retaining ultimate ownership and control of their data.

Martin Kleppmann also expanded on his view of what local-first is and where it's going in this [lofi.software](https://lofi.software) presentation:

<p>
  <iframe className="speakerdeck-embed"
      allowfullscreen="true" 
      data-ratio="1.3333333333333333"
      src="https://speakerdeck.com/player/354e9cbaebdc4d169f1ba5290be5d622"
      title="Where local-first came from and where it's going">
  </iframe>
</p>

Now, Electric is a system that syncs via the cloud. So, how closely do apps developed with Electric confirm to the definition and the spirit of local-first software?

## What is local-first software

In the local-first manifesto, Kleppmann et al coin the phrase "local-first software" because:

> it prioritizes the use of local storage (the disk built into your computer) and local networks (such as your home WiFi) over servers in remote datacenters.

In the manifesto, the authors contrast cloud apps with local-first apps:

> In cloud apps, the data on the server is treated as the primary, authoritative copy of the data; if a client has a copy of the data, it is merely a cache that is subordinate to the server. Any data modification must be sent to the server, otherwise it “didn’t happen.” In local-first applications we swap these roles: we treat the copy of the data on your local device — your laptop, tablet, or phone — as the primary copy. Servers still exist, but they hold secondary copies of your data in order to assist with access from multiple devices.

So we see from this two key principles:

1. use local storage and local networks over the cloud
1. treat local data and local writes as primary, rather than subordinate to the server

## What is ElectricSQL?

Electric syncs data via the cloud and is Postgres-centric, in that it uses Postgres as the source of truth for evolution of the database schema and authorisation rules.

The current workflow of developing with Electric is as follows:

1. you define your database schema [using Postgres migrations](../usage/data-modelling/migrations.md)
1. you run a CLI command to generate a [type-safe client library](../usage/data-access/client.md) with bundled database migrations
1. you import this library into your local application
1. you then [optionally connect](../usage/data-access/client.md#connectivity-methods) your local application to a sync service when you want multi-user or multi-device sync

Electric allows you to build apps that use local storage, specifically an embedded [SQLite](https://www.sqlite.org) or [PGlite](https://github.com/electric-sql/pglite) database in the local app. Your application code in the client app [talks directly to this local database](../usage/data-access/index.md) first. Data only goes over the network if you enable background sync.

Electric also treats local data and local writes as equal to writes from the server. In this, Electric maintains the principle of [finality of local writes](./architecture.md#local-writes): once a valid, non-malicious write is made locally, it is just as valid as any other data in the system and is not subject to approval or rejection by the server. Local writes are first class citizens and are not subordinate to the server.

However, when Electric syncs data, it does [sync through a cloud service and central Postgres database](./architecture.md), rather than via local networks or p2p sync. That said, sync is optional and Electric provides a [local-only-first mode](../api/cli.md#local-only-first-mode) for developing without running Postgres or a sync service in development.

The local database is entirely self-contained and works fine for purely offline, local-only applications. If at any point you take away the cloud Postgres or sync service, the local app will continue to function.

## The ideals of local-first software

As well as the definition above, the local-first manifesto also defines seven ideals of local-first software. What are they and does Electric conform to them?

#### 1. No spinners: your work at your fingertips

Electric supports low-latency, local data access.

<span className="badge badge--success">full support</span>

***

#### 2. Your work is not trapped on one device

Electric enables multi-device sync.

<span className="badge badge--success">full support</span>

***

#### 3. The network is optional

Electric sync is optional. Electric cloud services are optional -- in development and production. However, when data syncs, it is over the network rather than locally or p2p, so Electric only partially supports this ideal.

In future, we plan to add support for p2p and local network sync.

<span className="badge badge--warning mr-2">current: partial support</span>
<span className="badge badge--success">ambition: full support</span>

***

#### 4. Seamless collaboration with your colleagues

Electric enables seamless realtime multi-user sync.

<span className="badge badge--success">full support</span>

***

#### 5. The Long Now

> An important aspect of data ownership is that you can continue accessing the data for a long time in the future. When you do some work with local-first software, your work should continue to be accessible indefinitely, even after the company that produced the software is gone.

Electric does not operate any software. The Electric sync service is open source and designed for self host. It integrates with other standard open source software.

If Electric as a company dissappears, applications will continue to function. If the Electric sync layer ceases to function, local applications will still function. If the local application ceases to run, the data is still stored in a standard open source format (SQLite or Postgres).

<span className="badge badge--success">full support</span>

***

#### 6. Security and privacy by default

> One problem with the architecture of cloud apps is that they store all the data from all of their users in a centralized database. This large collection of data is an attractive target for attackers.

With Electric currently, if you enable sync, your data is stored in a central database. We are working to add end-to-end encryption. However, this is not currently implemented. We are also working to add more expressive primitives for controlling which data syncs off your local device.

<span className="badge badge--warning mr-2">current: partial support</span>
<span className="badge badge--success">ambition: full support</span>

***

#### 7. You retain ultimate ownership and control

With cloud apps, the service provider has the power to restrict user access Electric is not a service provider.

It is true that many people will choose to run Electric on-top-of managed Postgres hosting services. So it's important to be aware of who stores your backups and any access limitations. However, you can also just choose to run your own database and data on user devices is fully locally available with no server-imposed limitations.

<span className="badge badge--success">full support</span>

## Roadmap for ElectricSQL

A number of the current limitations with Electric impact it's local-first-ness. We aim to remove and improve these:

1. we have not yet implemented encryption; we have plans to add this in Q2 24
1. we want to improve our local-only-first DX, particularly integrating with locally defined schemas and providing a more seamless experience for progressively enabling sync
1. currently our DDLX and shapes API is oriented to controlling what syncs onto the device; we want to improve the primitives available to control what data syncs off the local device, including local tables and row/column level filtering, and making shape-based sync bidirectional
1. we want to make various recovery modes more sophisticated, so that clients can regain a sane state in the event of various errors without re-syncing from the server; we also want to improve our client-side developer tooling to enable easier local backups and swap in and out of local data states
1. we want to add support for local network and p2p sync

## Conclusion

The Electric system today confirms to most but not all of the ideals of local-first. We're aware that we're not perfect. We aim, in time, to fully conform to all aspects of the manifesto.

We also believe that local-first is a broad church and there is a spectrum of adherence to local-first principles. On this spectrum, Electric can be thought of as "more" local-first than server-authoritative systems (that treat local-writes as subordinate to the server) and "less" local-first than systems that can sync directly without going through a centralised point in the cloud.

Electric's brownfield positioning (we work with existing relational data models) also aims to help migrate mainstream relational systems onto a local-first architecture. Our "weakness" in terms of local-first, syncing through a central database, is our strength when it comes to being an on-ramp for mainstream commercial adoption of local-first as an architectural pattern.

We hope that by facilitating this adoption, we will help move the world towards a local-first future. One where online collaboration and users retaining ultimate ownership and control of their data are not mutually exclusive.
