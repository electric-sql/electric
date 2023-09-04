---
title: Instant local-first
sidebar_position: 10
pagination_label: Instant local-first
pagination_next: intro/multi-user
---

import InstantDemo from '!!raw-loader!@site/intro/src/demos/local-first/instant.jsx'

In this introduction, we're going to walk through local-first development and the ElectricSQL system. You're going to see what's good and different about it, explore some of the challenges and see how ElectricSQL solves them.

Along the way, we hope you'll be convinced to stop building cloud-first systems and switch to [#lo-fi](https://localfirstweb.dev/) ⚡ as your preferred development approach instead.

## Code along

This is an interactive demo. You can play with the widgets in the browser and you can play with the source code for the widgets in the live editor as you go. You can also find all the source code in the [examples/introduction](https://github.com/electric-sql/electric/tree/main/examples/introduction) folder of the main [electric&#8209;sql/electric](https://github.com/electric-sql/electric) repo.

:::note
If you just want the fastest way to start coding, jump to the [Quickstart](../quickstart/index.md) instead.
:::

## Let's get started

Electric is a system for building local-first apps. These apps interact directly with a local, embedded database. This is *consistently fast* compared with going over the network.

Below, there are two embedded demo apps:

1. **local-first** where the application code talks to a local embedded database
2. **cloud-first** where the application code talks to a cloud service

Have a play with the interfaces and see how responsive they feel.

<CodeBlock live={true} noInline={true} language="jsx">{
  InstantDemo
}</CodeBlock>

As you can see, the local-first one is consistently fast to interact with. There's no lag or loading spinners. Just instant reactivity.

The cloud-first one may feel fast or slow, depending on your network connection. If you have developer tools available, you can simulate a poor connection by opening up your browser console, going to the network tab and set throttling to "Slow 3G" or "Offline". How does the cloud-first app feel now?

Ultimately, if you have the network on your interaction path, the quality of your users' experience depends on their connectivity. Whereas with local-first, everything is instant, there are no loading spinners and you own your own UX and availability.

<hr className="doc-divider" />

Instant reactivity is one aspect of local-first. Another is [realtime multi-user](./multi-user.md) collaboration. Let's explore that next &raquo;
