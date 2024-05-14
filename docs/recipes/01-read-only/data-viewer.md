---
title: Data Viewer
description: Fast queriable table and chart views
sidebar_position: 30
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Tabs from '@theme/Tabs'
import TabItem from '@theme/TabItem'
import TOCInline from '@theme/TOCInline'

import SchemaSection from '../_section_schema.md'
import DataAccessSection from '../_section_data_access.md'
import UsageSection from '../_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/07-data_viewer_table.sql'
import TableHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/use_table_data.ts'
import ChartHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/use_chart_data.ts'
import TableView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/TableDataViewer.tsx'
import ChartView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/ChartDataViewer.tsx'

<video className="w-full mx-auto mb-3" autoPlay={true} loop muted playsInline>
  <source src={useBaseUrl('/videos/recipes/data-viewer.mp4')} />
</video>

In data-driven applications, providing users with intuitive tools to explore and visualize data is essential for informed decision-making and insights discovery. The users' explorations often involve filtering, sorting, and generally making complex queries on data. Those queries are often offloaded to the provider of the data, which can be slow due to round-trip delays, expensive as all computations are done on the server, and if the client querying is offline or with poor network connectivity, queries may fail and return no results, leading to a poor user experience.

With ElectricSQL, the [local-first development](/docs/intro/local-first) approach uses a local database for efficient querying, sorting, and filtering of data, enabling users to quickly and interactively explore datasets with ease, without worrying about network connectivity. By leveraging the power of SQL queries, developers can perform complex data manipulations and retrieve specific subsets of data based on user-defined criteria, ensuring a tailored and responsive viewing experience.

This recipe demonstrates how to use ElectricSQL to create a table and chart data viewer for a simple e-commerce-like orders database, delegating pagination, sorting, filtering, aggregation, and arbitrary queries to the underlying local database.

<TOCInline toc={toc} />

## Schema
<SchemaSection />

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

## Data Access
<DataAccessSection />

<Tabs groupId="data-access" queryString>
  <TabItem value="use-table-data" label="useTableData">
    <CodeBlock language="ts">
      {TableHook}
    </CodeBlock>
  </TabItem>
  <TabItem value="use-chart-data" label="useChartData">
    <CodeBlock language="ts">
      {ChartHook}
    </CodeBlock>
  </TabItem>
</Tabs>


## Usage
<UsageSection />

<Tabs groupId="view-component" queryString>
  <TabItem value="table-data-view" label="Table Data Viewer">
    <CodeBlock language="tsx">
      {TableView}
    </CodeBlock>
  </TabItem>
  <TabItem value="chart-data-view" label="Chart Data Viewer">
    <CodeBlock language="tsx">
      {ChartView}
    </CodeBlock>
  </TabItem>
</Tabs>




