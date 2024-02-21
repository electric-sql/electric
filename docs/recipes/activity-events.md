---
title: Activity Events
description: Live activity feed pattern with read acknowledgements
sidebar_position: 50
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import SchemaSection from './_section_schema.md'
import DataAccessSection from './_section_data_access.md'
import UsageSection from './_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/01-activity_events_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/activity_events/use_activity_events.ts'
import PopoverView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/activity_events/ActivityPopover.tsx'
import ToastView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/activity_events/ActivityToast.tsx'

TODO(msfstef): write overview

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

<Tabs groupId="view-component" queryString>
  <TabItem value="popover" label="Activity Popover">
    <CodeBlock language="tsx">
      {PopoverView}
    </CodeBlock>
  </TabItem>
  <TabItem value="toast" label="Activity Toast">
    <CodeBlock language="tsx">
      {ToastView}
    </CodeBlock>
  </TabItem>
</Tabs>
