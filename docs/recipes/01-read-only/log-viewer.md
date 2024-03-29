---
title: Log Viewer
description: Real-time logs with search filtering
sidebar_position: 20
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import TOCInline from '@theme/TOCInline'

import SchemaSection from '../_section_schema.md'
import DataAccessSection from '../_section_data_access.md'
import UsageSection from '../_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/02-logs_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/log_viewer/use_logs.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/log_viewer/LogViewer.tsx'

<video className="w-full mx-auto mb-3" autoPlay={true} loop muted playsInline>
  <source src={useBaseUrl('/videos/recipes/log-viewer.mp4')} />
</video>

Logs are a crucial component of any software application, offering valuable insights into its performance, errors, and user interactions, so you often need to expose them to your users and/or application administrators.

ElectricSQL provides a simple and efficient way to view logs in your application, with the ability to filter, sort, and paginate them efficiently while also receiving them live as they are being created.

This recipe demonstrates how to build a log viewer for arbitrary, unstructured text logs, such as web-server logs.

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

