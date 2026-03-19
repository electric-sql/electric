---
title: "State of PGlite Q1 2026"
description: >-
  An overview of what has been keeping us busy lately and what are PGlite's plans for the future.
excerpt: >-
  Lots of exciting new features have been released, with big plans ahead.
authors: [tudor, sam]
image: /img/blog/agent-skills-now-shipping/hero.png
imageWidth: 2752
imageHeight: 1536
tags: [PGlite, PostGIS, Postgres]
outline: [2, 3]
post: true
---

[PGlite](https://pglite.dev/) is a WASM port of the Postgres database that runs inside your JS environment, including your favorite browser. This means that you can benefit from the full power of PostgreSQL without ever leaving the V8 engine. 
We have seen an [impressive growth](https://www.npmjs.com/package/@electric-sql/pglite) over the last year, from about 500k to over 5 Million weekly downloads! PGlite is making its way in every corner of the software world, with usage varying from CICD  testing to [vibe coding with a database in the sandbox](https://electric-sql.com/blog/2025/06/05/database-in-the-sandbox). Our friends at [Prisma](https://www.prisma.io/) are [bundling PGlite](https://www.prisma.io/docs/postgres/database/local-development) within their CLI to give you a full dev env for rapid iteration and isolated testing within a single package. Try it with 

```bash
$ npx prisma dev
```

We have been receiving a lot of attention from the community [on various channels](https://news.ycombinator.com/item?id=46146133) and we're seeing an increase of external PRs (and issue reports 😁) on our [GH account](https://github.com/electric-sql/pglite/). All of these have motivated us to keep pushing PGlite further, in an attempt to run Postgres everywhere, [for everything](https://www.youtube.com/watch?v=3JW732GrMdg). Following is a "state of PGlite" article on what kept us busy lately and our future plans. But first, a little

## KISS

Unsurprisingly for an open source project, we're resource constrained. To make our life easier, we're always looking into simplifying everything that we're doing. As an example, we're relying on [vanilla emscripten](https://emscripten.org/) to build our [own fork of PostgreSQL](https://github.com/electric-sql/postgres-pglite). Another one is keeping external build dependencies in a [Docker builder](https://hub.docker.com/r/electricsql/pglite-builder) also lets us have a single entry point whenever these change and to use the same build environment on any host. But the biggest overhead and obstacle around moving faster and making simplifying maintenance is in supporting the aforementioned Postgres fork.

## Enter new PGlite

A major undertaking was refactoring our own changes to Postgres. We want to rely as much as possible on the upstream code and way of doing things. Minimizing our intervention on the upstream code is a high priority, allowing us to focus on what makes PGlite special.
As an example, consider the `initdb` workflow and code, which previously was embedded inside the final WASM executable. This lead to some hacks that needed to be accounted for whenever we updated our fork. With the new approach, initdb is a separate process that we instantiate and "connect" to PGlite, analogous to a regular Postgres deployment. We intercept the system calls that initdb is using to spawn a new Postgres instance and provide the necessary "plumbing" between the  two separate WASM processes, like stdin<->stdout redirection and sharing of the filesystem (see emscripten's [PROXYFS](https://emscripten.org/docs/api_reference/Filesystem-API.html#filesystem-api-proxyfs)). No `initdb` code changes are needed for this process! Moreover, this is very similar to what happens in a native PostgreSQL deployment, making the workflow easier to understand for any new contributor.

<figure>
  <img src="/img/blog/state-of-pglite-q1-2026/initdbpostgres.png" alt="initdb PostgreSQL plumbing in PGlite" />
  <figcaption>initdb and Postgres are separate WASM processes, PGlite provides the communication plumbing by intercepting the necessary system calls</figcaption>
</figure>

What's even better is that the same process could be imagined for other Postgres client tools, without much or any changes to their own code.

## Going multi-connection*

A usual Postgres deployment forks a new process for each new connection. This is not supported with emscripten and therefore PGlite is relying on PostgreSQL's single user mode. This limitation is further emphasised by our pglite-socket package, which is  a simple wrapper around the net module to allow PGlite to be used as a PostgreSQL server. This doesn't play well with all client tools which expect to be able to open multiple connections. The community stepped in with a PR that is able to multiplex concurrent connections over the single one provider by PGlite, among other improvements. Many thanks to @nickfujita for this!
* multiplexed over the single instance

## Call for extensions

Users have taken our [building PGlite extensions](https://pglite.dev/extensions/development#building-postgres-extensions) docs to the heart, with the likes of [pg_uuidv7](https://github.com/fboulnois/pg_uuidv7), [pgTAP](https://pgtap.org/), [pg_hashids](https://github.com/iCyberon/pg_hashids) and [Apache's AGE](https://github.com/electric-sql/pglite/pull/860) already part of the prod release. We are very grateful for these contributions, as well as the help we've received in bringing [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html) and in particular the long-awaited [PostGIS](https://postgis.net/) extension to PGlite. See more below!

This comes on top of most other contrib extensions that we're bundling in our package. Check out the full extension catalog [here](https://pglite.dev/extensions/).

## PostGIS

[PostGIS](https://postgis.net/) is a Postgres extension which adds support for storing, indexing, and querying geospatial data. For some users, it is the main reason for choosing PostgreSQL as their database. It is also one of the most requested extensions for PGlite. With the help of our community, we have managed to make it a reality! 
Among the challenges that we encountered when bringing PostGIS to PGlite are its many dependencies, all of which needed to be built for WASM. Moreover, Chrome, with its [8MB limit on sync loading dynamic libraries](https://chromestatus.com/feature/5099433642950656), made it more difficult for us to keep the extension as a single binary. In the end, the community stepped in and helped us make it a reality!

## Faster CI

Like any modern project, we rely on CI pipelines to make sure our code builds and the automated tests are green. And as any developers, we love when we get fast feedback! That's why we're happy that [Blacksmith](https://www.blacksmith.sh/) is offering us free credits through their OSS program to run our pipelines on their infra.

# What's brewing

Time to talk about the future! We have many, many ideas on how to improve and extend PGlite. Here are some of the major undertakings we're planing.

## Multi-instance

At the moment, PGlite is running in [single-user mode](https://www.postgresql.org/docs/current/app-postgres.html), which is single-instance. To bring more of Postgres' power, we are looking into removing this restriction and provide a true multi-user, multi-instance experience.

We are evaluating various options:

- a cooperative approach inspired by how certain embedded systems work
- a multi-threaded approach in which we would use a webworker for each instance

Note that these two are not mutually exclusive! We can image a situation where you would want multi-instance capabilities in an environment without webworkers!

Additionally, we are monitoring the work on [threading in Postgres](https://wiki.postgresql.org/wiki/Multithreading) as a potential route to a true, multiconnection PGlite.

## Replication

To further expand PGlite's impact in the world, we're looking into enabling Postgres' logical replication stream. There are multiple options here: enable replication on the single-user mode or build on the above multi-instance work. We already have a preference but we'll let you guess which one it is ;)

## libpglite

Our users love PGlite so much that they want to use it everywhere, including in non JS environments like mobile (and desktop) apps! This would be possible with a native built library with bindings for multiple languages. Although not real yet, this library already has a name: **libpglite**.
A crazy and beautiful idea proposed by our [Sam Willis](https://samwillis.uk/), the inventor of PGlite, is to decompile the WASM build to C, using something like [wasm2c](https://github.com/WebAssembly/wabt/tree/main/wasm2c). Then use the output to recompile it as a native library. Although this is still in the back of our minds, most probably we will NOT go this route and instead build a shared lib directly from source. Most of the WASM dependent instructions are restricted to a few files and by keeping Postgres changes to a minimum, it should be easier to build this new library.

There are so many use cases where PGlite could improve developers life that we're bound to make libpglite a reality!

## React native

Obviously one such area where PGlite will make a splash is in the mobile space. People have been asking for a React native port for ages, we even got a [draft PR](https://github.com/electric-sql/pglite/pull/774) from the community exploring exactly this. We're thinking that having `libpglite` will make it straightforward to bring it to React native!

## There's more!

We have plenty of other ideas, like providing a pre-populated FS as a package - such that you can skip `initdb` altogether; extend the API with a "streaming results" callback that gives you the results as soon as they are parsed; and many more.

## Encore

We couldn't end this article without telling you about some cheeky proposals gathered from the community:

- use the [file system API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) in the browser to write to disk
- build a (socket/webrtc) bridge to access a PGlite instance running in the browser from desktop tools like `psql`

We love them to pieces!

If you made it this far and want more, make sure to join us on [Discord](https://discord.gg/pVASdMED) or [GitHub](https://github.com/electric-sql/pglite/) and say hello!

Many thanks to all our contributors and users, your ❤️ keeps us going!

