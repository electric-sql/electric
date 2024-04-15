---
title: Chat Room
description: Interactive chat room with offline resilience
sidebar_position: 60
---

import useBaseUrl from '@docusaurus/useBaseUrl'
import TOCInline from '@theme/TOCInline'

import SchemaSection from '../_section_schema.md'
import DataAccessSection from '../_section_data_access.md'
import UsageSection from '../_section_usage.md'

import Schema from '!!raw-loader!@site/submodules/electric/examples/recipes/db/migrations/06-chat_room_table.sql'
import Hook from '!!raw-loader!@site/submodules/electric/examples/recipes/src/chat_room/use_chat_room.ts'
import View from '!!raw-loader!@site/submodules/electric/examples/recipes/src/chat_room/ChatRoom.tsx'


<video className="w-full mx-auto mb-3" autoPlay={true} loop muted playsInline>
  <source src={useBaseUrl('/videos/recipes/chat-room.mp4')} />
</video>

Building an engaging and real-time online chat room is essential for fostering community and enabling instant communication among users. Traditional approaches to implementing chat functionalities can lead to challenges with message delivery latency, data synchronization, and maintaining a seamless user experience across devices.

With ElectricSQL, the synchronization and consistency across multiple users and devices is [handled for you](/docs/intro/multi-user), allowing you to focus on building more exciting features and refining the user experience without worrying about messages being lost or arriving out of order. Additionally, the local-first approach to interactive applications means that you can build a chat room that is [resilient to users with poor connectivity](/docs/intro/offline).

This recipe demonstrates how to build a simple online chat room, with the ability to send and receive messages and preserve time ordering.

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
