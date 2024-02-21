---
title: Request Response
description: Event-sourcing pattern for API requests
sidebar_position: 80
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import SchemaSection from './_section_schema.md'
import DataAccessSection from './_section_data_access.md'
import UsageSection from './_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/03-request_response_tables.sql'
import QueryHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/use_electric_query.ts'
import QueryLogHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/use_electric_query_log.ts'
import QueryView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/RequestForm.tsx'
import QueryLogView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/RequestAuditLog.tsx'

TODO(msfstef): write overview

<SchemaSection />

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

<DataAccessSection />

<Tabs groupId="data-access" queryString>
  <TabItem value="use-electric-query" label="useElectricQuery">
    <CodeBlock language="ts">
      {QueryHook}
    </CodeBlock>
  </TabItem>
  <TabItem value="use-electric-query-log" label="useElectricQueryLog">
    <CodeBlock language="ts">
      {QueryLogHook}
    </CodeBlock>
  </TabItem>
</Tabs>

<UsageSection />

<Tabs groupId="view-component" queryString>
  <TabItem value="request-form" label="Request Form">
    <CodeBlock language="tsx">
      {QueryView}
    </CodeBlock>
  </TabItem>
  <TabItem value="request-audit-log" label="Request Audit Log">
    <CodeBlock language="tsx">
      {QueryLogView}
    </CodeBlock>
  </TabItem>
</Tabs>
