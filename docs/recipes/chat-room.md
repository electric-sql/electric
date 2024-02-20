---
title: Chat Room
description: Interactive chat room with offline resilience
sidebar_position: 60
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/06-chat_room_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/chat_room/use_chat_room.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/chat_room/ChatRoom.tsx'

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
