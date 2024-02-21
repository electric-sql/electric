---
title: Request-Response
description: Event-sourcing pattern for performing requests
sidebar_position: 80
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Tabs from '@theme/Tabs'
import TabItem from '@theme/TabItem'
import TOCInline from '@theme/TOCInline'

import SchemaSection from './_section_schema.md'
import DataAccessSection from './_section_data_access.md'
import UsageSection from './_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/03-request_response_tables.sql'
import QueryHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/use_electric_query.ts'
import QueryLogHook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/use_electric_query_log.ts'
import QueryView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/RequestForm.tsx'
import QueryLogView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/request_response/RequestAuditLog.tsx'

In modern web applications, efficiently handling request-response cycles while ensuring data integrity and responsiveness is paramount. Popular approaches to state transfer like [REST](https://en.wikipedia.org/wiki/REST) and [GraphQL](https://graphql.org/) can lead to complexities in managing concurrent requests and maintaining consistency across distributed systems, and they incur additional complexities when dealing with offline usage and intermittent connectivity.

While [local-first development](../intro/local-first) tends to reduce the need for external connectivity, there will be some sensitive or complex workloads such as [payment processing](../examples/checkout.md) that need to be handled by a secure server. Furthermore, redesigning a large application to be local-first can be a daunting task, and being able to gradually transition is often a safer path.

With ElectricSQL, state transfer is abstracted away by syncing the application's local database, and request-response cycles can be implemented using an [event-sourcing pattern](../integrations/event-sourcing/index.md). Requests can become entries in a table that get picked up by the server upon syncing using [database triggers](https://en.wikipedia.org/wiki/Database_trigger), and responses can be written to a related table that can be queried by the client. No complex retrying logic necessary, no additional code for queueing requests made while offline - clients submit requests locally, and because of Electric's [finality of local writes](../reference/architecture#local-writes) you can rest assured that the request will eventually be processed.

This recipe demonstrates how to build a declarative, reactive query tool (inspired by [TanStack Query](https://tanstack.com/query/v3/)), as well as a live request audit log.

<TOCInline toc={toc} />

## Schema
<SchemaSection />

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

## Data Access
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

## Usage
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
