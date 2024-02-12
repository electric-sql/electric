---
title: Log Viewer
sidebar_position: 10
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import LogViewerSchema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/02-logs_table.sql'
import useLogsHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/log_viewer/use_logs.ts'
import LogViewer from '!!raw-loader!@site/submodules/electric/examples/recipes/src/log_viewer/LogViewer.tsx'

Logs are a crucial component of any software application, offering valuable insights into its performance, errors, and user interactions, so you often need to expose them to your users and/or application administrators.

<video className="w-full mx-auto"
    autoPlay={true} loop muted playsInline>

  <source src={useBaseUrl('/videos/recipes/log-viewer.mp4')} />
</video>

Electric provides a simple and efficient way to view logs in your application, with the ability to filter, sort, and paginate them efficiently while also receiving them live as they are being created.

## Schema

<CodeBlock language="sql">
  {LogViewerSchema}
</CodeBlock>

## Data access

<CodeBlock language="ts">
  {useLogsHook}
</CodeBlock>

## Usage

<CodeBlock language="ts">
  {LogViewer}
</CodeBlock>
