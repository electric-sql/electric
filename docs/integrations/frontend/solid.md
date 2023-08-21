---
title: SolidJS
description: >-
  Simple and performant reactivity for building user interfaces.
sidebar_position: 20
---

:::caution Limitations
SolidJS support is not yet implemented. See <DocPageLink path="reference/limitations" /> for context.

[Let us know on Discord](https://discord.electric-sql/com) if you're interested in helping to develop SolidJS support. 
:::

### Implementation notes

[Solid's reactivity model](https://www.solidjs.com/guides/reactivity) should map fairly directly to the [existing React integration](https://github.com/electric-sql/electric/tree/main/clients/typescript/src/frameworks/react) with signals replacing state. There's also a [store interface](https://www.solidjs.com/docs/latest/api#createstore) that may be helpful.
