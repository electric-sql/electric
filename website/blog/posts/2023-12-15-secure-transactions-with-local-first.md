---
title: Secure transactions with local-first
description: >-
  You don't need to expose an API to perform secure transactions with local-first. Just emulate request - response over the in-paradigm sync.
authors: [thruflo]
image: /img/blog/secure-transactions-with-local-first/header.png
tags: [local-first, example app]
outline: deep
post: true
---

One of the most common questions we get asked about developing on ElectricSQL and local-first in general is how to do secure, confirmed transactions like bookings and payments. <!--truncate-->It's a great question, because you typically need to use a server for these type of transactions. You don't want to bundle secrets into a client app and the server can make sure that a transaction is only executed once.

The good news is that there's a simple pattern you can easily implement to do secure transactions with ElectricSQL and local-first applications in general. Read ahead for more context, or [jump straight to the solution](#solution--use-a-state-machine).

## What's the problem with secure transactions?

<figure>
  <a href="/img/blog/secure-transactions-with-local-first/cloud-first-with-bg.jpg"
      class="no-visual"
      target="_blank">
    <img src="/img/blog/secure-transactions-with-local-first/cloud-first.png" />
  </a>
</figure>

With a cloud-first architecture, the client typically makes a request to the server, the server processes the request, often interacting with a database, and then sends back a response. Two key aspects of this to highlight:

1. the server is a relatively trusted execution environment; it's the kind of environment where it's fine to have private API keys and other secrets available
1. the server can usually secure unique access to a task or database resource in order to prevent problems like double spending or placing orders twice

<figure>
  <a href="/img/blog/secure-transactions-with-local-first/local-first-with-bg.jpg"
      class="no-visual"
      target="_blank">
    <img src="/img/blog/secure-transactions-with-local-first/local-first.png" />
  </a>
</figure>

In contrast, with a local-first architecture, your app code talks directly to a local embedded database and runs in an untrusted environment. You can't have secrets or private API keys available because bundling them into your app exposes them to anyone who reads or decompiles your source code.

In addition, you have concurrency challenges. Multiple people can edit the same data, spend the same money or buy the same product without being aware of it.

## Going out-of-band loses consistency

One obvious solution is to use a local-first architecture for "normal" operations and a cloud-first architecture for operations that do. For example, provide an API endpoint that your client can call to place a Stripe payment. Call this directly over the network when you want to perform a payment. Then write the results back into the local database when done.

This can work fine for some systems. However, the problem is that you lose consistency.

Say you want to place an order for a product. You have the product data synced into your local app. You use this to construct an API call to your server to place the order. The snapshot of the database that your backend system sees is not the same as the snapshot of the data that your local app sees. This means that the instruction request may be out of sync and incompatible with the data available to the server.

In addition, when the backend service sends results of the operation back, you may want to merge the result back into the local database. If you do this, you're writing data based on one read snapshot (that the server process saw) that is not the same read snapshot that the client has.

This can cause a range of [integrity violations and anomalies](https://legacy.electric-sql.com/docs/reference/integrity). Because going out-of-band abandons the consistency guarantees of the sync system.

## Solution &mdash; use a state machine

Luckily, there is a simple solution. Use a state machine to emulate a request - response workflow over the in-band replication protocol. This supports secure background processing without losing consistency.

<figure>
  <a href="/img/blog/secure-transactions-with-local-first/state-machine.jpg"
      class="no-visual"
      target="_blank">
    <img src="/img/blog/secure-transactions-with-local-first/state-machine.png" />
  </a>
</figure>

The workflow is as follows:

1. write an instruction/request record to the local database
1. syncs this to the server over the replication stream as normal
1. process the instruction/request using a database change handler
1. write the result/response record back to the central database
1. sync this up to the client over the replication stream
1. wait in the client for a successful response before confirming to the user

As you can see, it's a simple pattern to emulate request - response over the local-first replication stream. There's no out of band data or consistency concerns. And all the actual state transfer should be handled for you automatically by the sync layer.

## Examples

### Checkout with ElectricSQL

The [Checkout example with Supabase](https://legacy.electric-sql.com/docs/examples/checkout) is a great example of this pattern. The app emulates the request response pattern for placing an order, using a database trigger to run a Supabase edge function for the backend processing.

You can see it running at [checkout-demo.electric-sql.com](http://checkout-demo.electric-sql.com/) and in the demo screencast below:

<div class="embed-container">
  <YoutubeEmbed video-id="WhRBvJ4cUWk" />
</div>

### trcp-crdt

Kyle Mathews' [trpc-crdt](https://bricolage.io/announcing-trpc-crdt/) is another twist on this pattern. It uses Electric as the transport layer for tRPC requests.

You can see the source code at [KyleAMathews/trpc-crdt](https://github.com/KyleAMathews/trpc-crdt) and an example of it running below, via the [vite-react-router-electric-sql-starter](https://github.com/KyleAMathews/vite-react-router-electric-sql-starter):

<figure>
  <div class="embed-container">
    <video controls>
      <source src="https://github.com/KyleAMathews/vite-react-router-electric-sql-starter/assets/71047/f91196c1-a04c-4e36-8477-e9d1ae977d8c" />
    </video>
  </div>
</figure>

## Conclusion

You don't need to expose an API or leak any secrets to perform secure transactions with local-first. Just emulate request - response over the in-paradigm sync and use your preferred [event sourcing](https://legacy.electric-sql.com/docs/integrations/event-sourcing) system.
