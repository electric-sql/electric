---
title: Monitoring Metrics
description: Live metric monitoring with arbitrary time aggregation and view window
sidebar_position: 40
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import TOCInline from '@theme/TOCInline'

import SchemaSection from '../_section_schema.md'
import DataAccessSection from '../_section_data_access.md'
import UsageSection from '../_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/04-monitoring_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/monitoring_metrics/use_monitoring_metrics.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/monitoring_metrics/MonitoringChart.tsx'

<video className="w-full mx-auto mb-3" autoPlay={true} loop muted playsInline>
  <source src={useBaseUrl('/videos/recipes/monitoring-metrics.mp4')} />
</video>

Often times mission-critical metrics need to be monitored in real-time to ensure operations are running smoothly. This is often done through polling or streaming aggregated data, resulting in delays and slow queries when you want to drill in to the finer details - e.g. going from a 5 minute period to a 10 second period.

ElectricSQL provides a simple way to monitor metrics, with the relevant data synced locally for fast access while retaining real-time updates.

This recipe demonstrates how to build a chart for a monitoring dashboard that measures system metrics, such as CPU usage.

<TOCInline toc={toc} />

## Schema
<SchemaSection />

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

## Data Access
<DataAccessSection />

<CodeBlock language="ts">
  {Hook}
</CodeBlock>

## Usage
<UsageSection />

<CodeBlock language="tsx">
  {View}
</CodeBlock>

