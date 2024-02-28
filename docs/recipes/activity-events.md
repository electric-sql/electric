---
title: Activity Events
description: Live activity feed pattern with read acknowledgements
sidebar_position: 50
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Tabs from '@theme/Tabs'
import TabItem from '@theme/TabItem'
import TOCInline from '@theme/TOCInline'

import SchemaSection from './_section_schema.md'
import DataAccessSection from './_section_data_access.md'
import UsageSection from './_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/01-activity_events_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/activity_events/use_activity_events.ts'
import PopoverView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/activity_events/ActivityPopover.tsx'
import ToastView from '!!raw-loader!@site/submodules/electric/examples/recipes/src/activity_events/ActivityToast.tsx'

<video className="w-full mx-auto" autoPlay={true} loop muted playsInline>
  <source src={useBaseUrl('/videos/recipes/activity-events-toast.mp4')} />
</video>

In today's social-media-driven world, keeping users engaged and informed about relevant activities within your application is crucial for driving interaction and fostering a sense of community. Implementing activity notifications, such as likes, comments, and mentions, enhances the user experience by providing real-time updates on their interactions and connections.

With ElectricSQL, implementing activity events in your local-first application becomes a seamless process. ElectricSQL handles the complex task of synchronizing activity data [across multiple users and devices](../intro/multi-user.md), ensuring that notifications are delivered promptly and consistently, regardless of network conditions or device types.

This recipe demonstrates how to build a basic activity feed with read acknowledgements and dynamic actions that can be used for both notification popovers or toasts.

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
