---
title: Background Jobs
sidebar_position: 40
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/05-background_jobs_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/background_jobs/use_background_jobs.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/background_jobs/BackgroundJobs.tsx'

TODO(msfstef): write overview

## Schema

<CodeBlock language="sql">
  {Schema}
</CodeBlock>

## Data access

<CodeBlock language="ts">
  {Hook}
</CodeBlock>

## Usage

<CodeBlock language="tsx">
  {View}
</CodeBlock>
