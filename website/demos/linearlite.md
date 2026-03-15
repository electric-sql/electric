---
title: Linearlite
description: >-
  Local-first project management app built with Electric and PGlite.
deployed_url: https://linearlite.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/linearlite
listing_image: /img/demos/linearlite-demo.png
image: /img/demos/linearlite-screenshot.png
demo: true
homepage: true
order: 10
---

# Linearlite

[Linear](https://linear.app) project management app clone, built using [Electric](/products/postgres-sync) and [PGlite](/products/pglite).

<DemoCTAs :demo="$frontmatter" />

## Linearlite using Electric and PGlite

<DemoEmbed :demo="$frontmatter" />

This demonstrates a fully-interactive, offline capable, real-world app with a large data set. It shows both fast initial data loading and instant local reactivity, despite a very large data set loaded into the local database.

Writes are handled using [through the DB sync](/docs/guides/writes#through-the-db) with sophisticated merge logic. See the [`README` in the example folder](https://github.com/electric-sql/electric/tree/main/examples/linearlite) for more information.

<DemoCTAs :demo="$frontmatter" />
