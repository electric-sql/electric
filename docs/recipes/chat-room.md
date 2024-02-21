---
title: Chat Room
description: Interactive chat room with offline resilience
sidebar_position: 60
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/06-chat_room_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/chat_room/use_chat_room.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/chat_room/ChatRoom.tsx'

Building an engaging and real-time online chat room is essential for fostering community and enabling instant communication among users. Traditional approaches to implementing chat functionalities can lead to challenges with message delivery latency, data synchronization, and maintaining a seamless user experience across devices.

With ElectricSQL, the synchronization and consistency across multiple users and devices is handled for you, allowing you to focus on building more exciting features and refining the user experience without worrying about messages being lost or arriving out of order.

On top of that, the local-first approach to interactive applications means that you can build a chat room that is resilient to users having intermittent connectivity.
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
