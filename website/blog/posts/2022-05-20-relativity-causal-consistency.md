---
title: Relativity and causal consistency
description: >-
  Causal consistency is the best model for our relativistic world.
authors: [thruflo]
image: /img/blog/relativity-causal-consistency/listing.png
tags: [local-first]
outline: deep
post: true
---

In this post we explore the assumptions that distributed databases are based on and investigate how causal consistency fits the reality of a relativistic universe.

<!--truncate-->

Most distributed databases today are designed around two assumptions: first, that events occur in some sort of total order, and second, that the latencies we have to deal with are upper bounded by the amount of time it takes to go around the earth. These assumptions have allowed us to more easily reason about and build data models, but they increasingly don’t reflect the underlying reality of what the data models will be used for. In this post we’ll explore why not and how this maps to local-first software.

## Distributed databases

The longstanding question in local-first and distributed databases is how to accept concurrent writes in a way that’s both responsive and consistent.

The current generation of distributed databases typically achieves this by simulating a single-node system using consensus and coordination. In order to accept a write, the node you’re talking to coordinates with all the other nodes to agree on a total order and on whether to accept the write.

Implicit in this consensus mechanism are the two assumptions above – that 1) there is such a thing as a total order, i.e.: that I can say with certainty that event A at Node 1 precedes event B at Node 2 which precedes event C at Node 3 and so on for all the events that hit the database and 2) the network latencies involved in reaching consensus are in the hundreds of milliseconds, and thus acceptable to users.

## Relativity

At first glance, these assumptions appear reasonable – we tend to view time linearly and expect near instantaneous responses in calls, text messages, etc – but in fact they’re arbitrary and very much a consequence of our limited perspective as earth dwellers. If we broaden our perspective to one in which earth is a tiny planet, separated from other planets by huge distances, a far more accurate perspective is one in which relativistic effects are taken into account. At that point, both the assumptions no longer hold.

To see this, first, let’s consider the total ordering assumption. Imagine that Alice and Bob are standing on two separate planets, one light year apart. In Alice’s frame of reference, she sends a message to Bob on day 0, and receives a message from Bob on day 365. In Bob’s frame of reference, he sent a message on day 0 and received one from Alice on day 365. Which message was sent first depends on the position of the observer. A node on Mars may think Alice’s was first, while a node in the Oort cloud may think that Bob’s was first.

The point is that there’s no right answer, because they’re all working in completely different frames of reference. According to the relativity of simultaneity, there’s no total ordering of events that are separated by space.

<figure>
  <a href="/img/blog/relativity-causal-consistency/graph.png"
      class="no-visual"
      target="_blank">
    <img src="/img/blog/relativity-causal-consistency/graph.png"
        style="width: 100%; max-width: 450px;"
    />
  </a>
</figure>

> [!NOTE] No total ordering of events
> In physics, the [relativity of simultaneity](https://en.wikipedia.org/wiki/Relativity_of_simultaneity) is the concept that distant simultaneity – whether two spatially separated events occur at the same time – is not absolute, but depends on the observer's reference frame.

## Latency

Now, let’s consider the latency assumption. We happen to live on a planet where any two points are separated by less than hundreds of milliseconds. But what would happen if our planet were 20x bigger, or we’re trying to build applications that work across planets? (This isn’t as far-fetched as it might sound. Already, we’re building software that must work in space on satellites).

The latency between Earth and Mars is somewhere between 4 and 20 minutes. The consensus algorithms that the current generation of distributed databases depend on take at least three server-to-server hops to order events. Reaching consensus just between Earth and Mars would potentially take hours.

So what to do?

## Causal consistency

Enter causal consistency. A distributed system that implements causal consistency discards total ordering by timestamps in favor of causal ordering. With causal ordering, if event A causes event B, then event A precedes event B in every frame of reference.

For example, if Alice posts a comment on a collaborative document and Bob then responds to that comment, it doesn’t matter if Alice and Bob are standing light-years apart – Claire will never see Bob’s reply without Alice’s message. Causally consistent databases keep track of causal relationships (using vector clocks), but allow other events that aren’t causally related to be *indeterminately* ordered, so that there’s no need for a total order to be imposed.

<div class="side-by-side-videos">
  <div class="embed-container">
    <iframe src="https://www.youtube-nocookie.com/embed/OKHIdpOAxto"
        allow="encrypted-media; fullscreen; picture-in-picture"
        sandbox="allow-same-origin allow-scripts">
    </iframe>
  </div>
  <div class="embed-container">
    <iframe src="https://www.youtube-nocookie.com/embed/x-D8iFU1d-o"
        allow="encrypted-media; fullscreen; picture-in-picture"
        sandbox="allow-same-origin allow-scripts">
    </iframe>
  </div>
</div>

### Embracing relativity

As a protocol, causal consistency frees us from the total ordering and low latency assumptions. It can cope with the relativity of perspective in space time, and since it is able to take a write without coordinating, it also sidesteps the latency questions.

As we increasingly move our computer systems into space, it enables us to build applications that actually fit, rather than fight, the [scale](https://www.youtube.com/watch?v=0fKBhvDjuy0) and [relativity](https://en.wikipedia.org/wiki/Relativity_of_simultaneity) of the universe we inhabit.

### Embracing causal consistency

Here on earth right now, causal consistency -- and specifically the [transactional causal consistency that ElectricSQL is based on](https://legacy.electric-sql.com/docs/reference/consistency) -- is the strongest possible consistency mode for a coordination-free, local-first system.

Embracing it allows you to develop local-first systems that fit the world more naturally than consensus based systems and, as a result, eliminate complexity and dissonance from mapping a total order onto a fundamentally concurrent and relativistic world.
