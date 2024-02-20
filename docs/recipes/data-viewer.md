---
title: Data Viewer
description: Fast queriable table and chart views
sidebar_position: 30
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/07-data_viewer_table.sql'
import TableHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/use_table_data.ts'
import ChartHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/use_chart_data.ts'
import TableView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/TableDataViewer.tsx'
import ChartView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/data_viewer/ChartDataViewer.tsx'

TODO(msfstef): write overview

## Schema

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

## Data access

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




