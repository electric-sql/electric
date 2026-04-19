---
title: Bash
description: >-
  Example using Electric from a bash script.
source_url: https://github.com/electric-sql/electric/tree/main/examples/bash
example: true
order: 10
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Electric using `curl` in `bash`

This example shows how to use the Electric HTTP API directly from the terminal using `bash` and `curl`.

<<< @../../examples/bash/client.bash{bash}

<DemoCTAs :demo="$frontmatter" />
