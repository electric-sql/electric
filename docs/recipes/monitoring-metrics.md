---
title: Monitoring Metrics
description: Live metric monitoring with arbitrary time aggregation and view window
sidebar_position: 40
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/04-monitoring_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/monitoring_metrics/use_monitoring_metrics.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/monitoring_metrics/MonitoringChart.tsx'

Often times mission-critical metrics need to be monitored in real-time to ensure operations are running smoothly. This is often done through polling or streaming aggregated data, resulting in delays and slow queries when you want to drill in to the finer details - e.g. going from a 5 minute period to a 10 second period.

Electric provides a simple way to monitor metrics, with the relevant data synced locally for fast access while retaining real-time updates.

## Schema

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

## Data access

<CodeBlock language="ts">
  {Hook}
</CodeBlock>

## Usage

<CodeBlock language="tsx">
  {View}
</CodeBlock>
