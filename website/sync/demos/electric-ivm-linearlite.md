---
title: LinearLite on Electric-IVM
description: >-
  Linear-style issue tracker synced through an experimental DBSP-based Electric
  engine, paired with a live pipeline visualizer.
source_url: https://github.com/balegas/electric-ivm
blog_post_url: /blog/2026/07/17/electric-circuits
listing_image: /img/demos/electric-ivm-linearlite-placeholder.png
image: /img/demos/electric-ivm-linearlite-placeholder.png
demo: true
---

# LinearLite on Electric-IVM

<!-- TODO: replace listing_image/image above with a real screenshot before publishing. -->

The [LinearLite](https://linear.app)-style issue tracker, running on an experimental version of Electric [built on DBSP](/blog/2026/07/17/electric-circuits) — an incremental view maintenance engine. Every write to Postgres is shown flowing through the DBSP circuit, live, in the pipeline visualizer alongside the app.

<DemoCTAs :demo="$frontmatter" />

## LinearLite + the pipeline visualizer

<figure>
  <img :src="$frontmatter.image" alt="LinearLite issue tracker next to the electric-ivm pipeline visualizer, showing a write propagating through filters, joins and subquery membership down to a shape's stream" />
</figure>

There's no hosted instance of this one yet — the engine is an experimental prototype, not a production service. Clone the [repository](https://github.com/balegas/electric-ivm) and follow its README to run LinearLite and the visualizer side by side against your own Postgres.

<DemoCTAs :demo="$frontmatter" />
