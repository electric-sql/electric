---
title: Integrations
slug: /integrations
---

import DocCardList from '@theme/DocCardList';

ElectricSQL is designed to work as a drop-in solution for existing applications and stacks.

It works with standard open-source Postgres and SQLite. In the frontend, you [adapt the standard SQLite driver](../integrations/drivers/index.md) for your target environment and bind live data to your existing [reactivity and component framework](../integrations/frontend/index.md).

In the backend, you can use your existing [web framework and migrations tooling](../integrations/backend/index.md) to manage content and evolve the database schema and standard [event sourcing tools](../integrations/event-sourcing/index.md) to integrate server-side workflows and background processing.

<DocCardList />
