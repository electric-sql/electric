---
title: Write patterns
description: >-
  Four different patterns for handling writes in an Electric application.
deployed_url: https://write-patterns.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/write-patterns
image: /img/demos/write-patterns-screenshot.png
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Handling writes with Electric

This example implements and describes four different patterns for handling writes in an application built with [Electric](/products/postgres-sync).

These patterns are described in the [Writes guide](/docs/guides/writes). The idea is that if you walk through the patterns in turn, you can get a sense of the range of techniques and their evolution in both power and complexity.

The example is set up to run all the patterns together, in the page, at the same time, as components of a single React application. So you can also evaluate their behaviour side-by-side and and with different network connectivity.

<DemoEmbed :demo="$frontmatter" />

<DemoCTAs :demo="$frontmatter" />
