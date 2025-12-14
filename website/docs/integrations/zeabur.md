---
outline: deep
title: Zeabur - Integrations
description: >-
  How to deploy Electric on Zeabur.
image: /img/integrations/electric-zeabur.jpg
---

<img src="/img/integrations/zeabur.svg" class="product-icon" />

# Zeabur

[Zeabur](https://zeabur.com) is a cloud infrastructure and web hosting platform.

## Electric and Zeabur

You can use Zeabur to deploy [a PostgreSQL instance](https://zeabur.com/templates/B20CX0), [an Electric sync service](#deploy-electric) and your client application.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Electric

Zeabur offers a one-click deployment button here:

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/NA09VV)

The defaults include protection with an [API token](/docs/guides/security#api-token), a caching proxy, and a persistent disk. Please refer to the instructions in the Zeabur template for additional deployment guidance.

You can also optionally use `/v1/health` as the path for a health check.
