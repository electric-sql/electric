---
title: Todo app
description: >-
  This is a classic TodoMVC example app, developed using Electric.
source_url: https://github.com/electric-sql/electric/tree/main/examples/todo-app
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Todo MVC using Electric

The main Electric code is in [`./src/routes/index.tsx`](https://github.com/electric-sql/electric/blog/main/examples/todo-app/src/routes/index.tsx):

<<< @../../examples/todo-app/src/routes/index.tsx{tsx}

<DemoCTAs :demo="$frontmatter" />
