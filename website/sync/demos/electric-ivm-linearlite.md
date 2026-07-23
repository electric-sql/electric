---
title: LinearLite on Electric Circuits
description: >-
  Linear-style issue tracker running on Electric Circuits, an experimental
  DBSP-based Electric engine, paired with a live circuit visualizer.
source_url: https://github.com/electric-sql/electric-circuits
blog_post_url: /blog/2026/07/17/electric-circuits
listing_image: /img/demos/electric-ivm-linearlite-placeholder.png
image: /img/demos/electric-ivm-linearlite-placeholder.png
demo: true
---

# LinearLite on Electric Circuits

<!-- TODO: replace listing_image/image above with a real screenshot before publishing. -->

The [LinearLite](https://linear.app)-style issue tracker, running on [Electric Circuits](/blog/2026/07/17/electric-circuits) — an experimental version of Electric built on DBSP, an incremental view maintenance engine. Every write to Postgres is shown flowing through the circuit, live, in the circuit visualizer alongside the app.

<DemoCTAs :demo="$frontmatter" />

## LinearLite + the circuit visualizer

<figure>
  <img :src="$frontmatter.image" alt="LinearLite issue tracker next to the circuit visualizer, showing a write propagating through filters, joins and subquery membership down to a live query's stream" />
</figure>

There's no hosted instance of this one yet — Electric Circuits is a research preview, not a production service. Clone the [repository](https://github.com/electric-sql/electric-circuits) and follow its README to run LinearLite and the circuit visualizer side by side against your own Postgres.

<DemoCTAs :demo="$frontmatter" />
