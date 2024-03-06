---
title: Background Jobs
description: Event-sourcing pattern for scheduling back-end jobs
sidebar_position: 70
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import TOCInline from '@theme/TOCInline'

import SchemaSection from '../_section_schema.md'
import DataAccessSection from '../_section_data_access.md'
import UsageSection from '../_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/05-background_jobs_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/background_jobs/use_background_jobs.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/background_jobs/BackgroundJobs.tsx'

<video className="w-full mx-auto mb-3" autoPlay={true} loop muted playsInline>
  <source src={useBaseUrl('/videos/recipes/background-jobs.mp4')} />
</video>

In modern web applications, performing tasks asynchronously in the background is essential for maintaining security, responsiveness, and scalability. Whether it's performing complex computations, sending emails, or doing any sensitive operation like [processing payments](/docs/examples/checkout.md), background jobs allow applications to offload these tasks from the client to a server, ensuring a smooth user experience.

With ElectricSQL, state transfer is abstracted away by syncing the application's local database, but background jobs can still be managed through an [event-sourcing pattern](/docs/integrations/event-sourcing/index.md). The client can schedule a job as an entry to a local table, which the server will eventually pick up through a [trigger](https://en.wikipedia.org/wiki/Database_trigger) on the backend database and perform the necessary processing, optionally writing results to the same and/or other tables that will be synced back to the client.

This recipe shows how to implement a simple background job system using ElectricSQL, and highlights the advantages of using an event-sourcing pattern such as offline resilience and having a complete audit log of all jobs submitted with no additional effort.

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
