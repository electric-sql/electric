---
title: Background Jobs
description: Event-sourcing pattern for scheduling back-end jobs
sidebar_position: 70
---

import useBaseUrl from '@docusaurus/useBaseUrl'

import SchemaSection from './_section_schema.md'
import DataAccessSection from './_section_data_access.md'
import UsageSection from './_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/05-background_jobs_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/background_jobs/use_background_jobs.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/background_jobs/BackgroundJobs.tsx'

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

<CodeBlock language="tsx">
  {View}
</CodeBlock>
