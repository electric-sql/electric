---
title: Event sourcing
sidebar_position: 50
---

import DocCardList from '@theme/DocCardList'

One of the key aspects of [local-first software development](/blog/2023/02/09/developing-local-first-software) is using event sourcing to trigger server-side / background processing.

ElectricSQL doesn't provide yet-another event sourcing solution. Instead it defers to existing change data capture systems that work with Postgres.

This section provides a summary of some of your options, including triggers, logical replication and streaming database integrations.

<DocCardList />
