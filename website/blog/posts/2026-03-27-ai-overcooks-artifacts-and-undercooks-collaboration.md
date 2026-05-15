---
title: "AI overcooks artifacts and undercooks collaboration"
description: >-
  AI can produce polished artifacts before teams have built shared understanding. The discipline is knowing when to stop and leave room for collaboration.
excerpt: >-
  Sometimes the problem is not bad output, but output that is too finished too soon. When artifacts become more resolved than the collaboration around them, teams lose the negative space needed to think together.
authors: [samwillis]
image: /img/blog/ai-overcooks-artifacts-and-undercooks-collaboration/hero.jpg
imageWidth: 1536
imageHeight: 1024
tags: [agentic, AI, collaboration]
outline: [2, 3]
post: true
---

I keep running into a failure mode in my own work.

Not slop, but almost the opposite. The models are now good enough that they can take a rough thought and turn it into something clear, persuasive, and oddly complete before a team has really had the chance to think together.

### Overcooking the artifacts

I’ve done this myself. I’ve written an RFC that should have been a PRD. I’ve let a rough concept harden into an implementation plan too early. I’ve taken a collaborative game demo too far on my own, then had to roll ideas back because the team hadn’t really had the conversation yet.

In each case, the problem wasn’t that the artifact was bad - it was that it was too finished.

That’s what I mean by **overcooking**. An artifact is overcooked when it arrives more resolved than the collaboration around it. It has detail, structure, momentum, and maybe even a sense of inevitability, yet the shared understanding still lags behind it.

### Undercooking the collaboration  

What gets lost is **negative space**: the room other people need to imagine into and around the thing. The space to connect with, to push, or reshape, and to feel some ownership over where an idea is going, disappears.

AI is very good at removing that space, and I think this changes the emotional texture of collaboration far more than people are comfortable admitting. If someone wants to be involved creatively and instead gets handed something highly resolved, they’re much more likely to react negatively. Not necessarily in a dramatic way, but instead as resistance, perhaps nitpicking, or sometimes just giving the flat sense that the energy has gone from the room. They’re no longer being invited to help make the thing, but being asked to react to it instead.

### The implementation trap  

Martin Fowler has a good term for one version of this in software: the [**Implementation Trap**](https://www.martinfowler.com/articles/reduce-friction-ai/design-first-collaboration.html). AI jumps from requirement to implementation so quickly that important decisions arrive embedded in the output. By the time anyone else sees them, they’re no longer joining the design conversation; they’re reviewing a shaped result.

Once you start looking, it shows up all over the place:

Documents drift a category forward, something that should have opened a discussion quietly starts closing one; a prototype stops being a probe and starts acting like a decision; the artifact arrives with more certainty than the team has actually earned.

You can see the same pressure from the maintainer side in open source. The cost of producing something that looks like a contribution has dropped, but cost of reviewing it has not. So the scarce thing is no longer artifact production, but context, judgment, and shared understanding.

### Human <-> agent collaboration  

At Electric, we’ve been spending a lot of time on the technical wiring for [human↔agent collaboration](https://durablestreams.com). But the more we work on that, the more it feels like the human side matters just as much. It’s not only about making the systems work. It’s about making sure AI doesn’t crowd out the space people need to think with each other.

I don’t see this as an argument against AI. It’s an argument for leaving room.

The new discipline is not just making stronger artifacts. It’s knowing when to stop before you fill in all the negative space.

Perhaps this applies to writing about the problem too, so I’m trying not to overcook this post in the same way.

I’d rather leave a little space in it for other people to think into.

---

Have you seen this happening with your own work? What tools or processes have you implemented to help make room for human collaboration in the age of AI? Ping me on [Discord](https://discord.gg/electric-sql) or [X](https://x.com/samwillis). <!-- TODO: link to threads -->
