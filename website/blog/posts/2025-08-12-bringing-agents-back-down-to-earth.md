---
title: Bringing agents back down to earth
description: >-
  Agentic AI, beneath all the hype, is actually just normal software. You can build agentic systems with a database, standard web tooling and real-time sync.
excerpt: >-
  Agentic AI, beneath all the hype, is actually just normal software. You can build agentic systems with a database, standard web tooling and real-time sync.
authors: [thruflo]
image: /img/blog/bringing-agents-back-down-to-earth/header2.jpg
tags: [db, tanstack-db, postgres-sync]
outline: [2, 3]
post: true
---

<script setup>
  import { data } from '../../data/posts.data.ts'
  const posts = data.filter(post => {
    return post.path === '/blog/2025/07/29/local-first-sync-with-tanstack-db'
  })

  import BlogPostListing from '../../src/components/BlogPostListing.vue'
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
</script>

<style scoped>
  .listing {
    display: grid;
    grid-template-columns: 1fr;
    gap: 32px;
    margin: 24px 0;
    overflow: hidden;
  }
  @media (max-width: 1049px) {
    .listing {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 949px) {
    .listing {
      gap: 32px;
      margin: 24px 0;
    }
  }
  @media (max-width: 749px) {
    .listing {
      grid-template-columns: 1fr;
      gap: 32px;
      margin: 20px 0;
    }
  }
  @media (max-width: 549px) {
    .listing {
      margin: 20px 0;
    }
  }
</style>

There's a lot of hype around agentic system development. Concepts like agentic memory, instruction routing, retrieval and context engineering.

But when you dig into it, these all collapse to processes and database state. In fact, you can build agentic systems with a database, standard web tooling and real-time sync.

> [!Warning] Agentic demo app
> See the [🔥 Burn demo app](/demos/burn) and [source code](https://github.com/electric-sql/electric/tree/main/examples/burn). It's an agentic system built on Postgres and real-time sync, designed to illustrate the concepts in this post.

<figure>
  <div class="embed-container" style="padding-bottom: 75.842697%">
    <YoutubeEmbed video-id="4QpErQ9nVEc" />
  </div>
</figure>

## Simplifying the agentic stack

We've had decades to evolve the [patterns of traditional software](https://12factor.net). We're scrambling, as an industry, to figure out the [patterns of agentic software](https://github.com/humanlayer/12-factor-agents).

<figure>
  <a href="https://www.ai.engineer/summit/2025" class="no-visual">
    <img src="/img/blog/bringing-agents-back-down-to-earth/ai-infra.jpg"
        alt="AI summit slide showing explosion of AI infra"
    />
  </a>
</figure>

LangChain, vector databases, instruction routing, specialized memory stores. You'd be forgiven for thinking you need a whole new stack to build agentic systems.

However, that isn't actually the case.

### What is agentic software?

Agents are essentially processes that instruct LLMs to make tool calls.

Instructing LLMs means sending an instruction to an LLM. Agentic memory is where you store data that those instructions are based on. Retrieval is the ability to query that data. Context engineering retrieves and formats the right information to send in the instruction.

### Rubbing a database on it

There's obviously a lot of work involved in putting those aspects together to create a working agentic product. Memory compaction, finding the right context, the right control flow. Balancing structure and autonomy. These are all hard, fascinating design and engineering challenges.

However, from an _infra_ point of view, there's nothing there that doesn't [pattern match to a database](https://www.hytradboi.com/2025), some processes and real-time sync.

<figure>
  <img src="/img/blog/bringing-agents-back-down-to-earth/agents-are-database-state.jpg"
      alt="Astronaut meme template. Wait, agents are just state in the database? Always have been"
  />
</figure>

Ultimately, processes are a [standard software primitive](https://hexdocs.pm/elixir/processes.html). As are routing, messaging, control flow, [supervision hierarchies](https://hexdocs.pm/elixir/Supervisor.html) and [loops](https://www.google.com/search?q=recursion).

## Building an agentic system

[🔥 Burn is an agentic demo app](/demos/burn) where the UI, the agentic control flow and the context engineering are all driven by database state and [real-time sync](/blog/2025/04/09/building-ai-apps-on-sync).

It's a multi-user, multi-agent, burn or "roast-me" app. Users sign-up, create and join threads. Each thread has [a producer agent, called Sarah](https://github.com/electric-sql/electric/burn/blob/main/examples/burn/lib/burn/agents/sarah.ex), who finds out facts about the users and two comedian agents ([Jerry Seinfeld](https://github.com/electric-sql/electric/burn/blob/main/examples/burn/lib/burn/agents/jerry.ex) and [Frankie Boyle](https://github.com/electric-sql/electric/burn/blob/main/examples/burn/lib/burn/agents/frankie.ex)) who monitor the facts and roast the users when they have enough to go on.

<figure>
  <div class="embed-container" style="padding-bottom: 75.842697%">
    <YoutubeEmbed video-id="2DhGHnk3Ebc" />
  </div>
</figure>

Technically, it's built on:

- [Postgres](#standard-postgres)
- [Phoenix.Sync](#phoenix-sync)
- [TanStack DB](#tanstack-db)

In the back-end, agents subscribe to events in their thread. When something happens, they instruct the LLM by making a request to the [Anthropic API](https://docs.anthropic.com/en/api/messages). The LLM responds with a tool call. Tool calls are handled by the system and potentially generate new events, triggering another instruction loop.

In the front-end, the UI is reactively wired up to the same data model and automatically updates whenever anything happens. The main UI is based around chat threads. Plus there's also a ["computer" sidebar](#computer-sidebar) that functions a bit like a debug view, showing you what's happening in the database, under the hood, in real-time.

### Standard Postgres

The data model is based on `Users` joining `Threads`, which are driven by `Events` and accumulate `Facts`. These are all stored in a Postgres database.

```text
➜  ~ psql "postgresql://postgres:postgres@localhost:5432/burn_dev"
psql (17.4)
Type "help" for help.

burn_dev=# \d
               List of relations
 Schema |       Name        | Type  |  Owner
--------+-------------------+-------+----------
 public | events            | table | postgres
 public | facts             | table | postgres
 public | memberships       | table | postgres
 public | schema_migrations | table | postgres
 public | threads           | table | postgres
 public | users             | table | postgres
(6 rows)

burn_dev=# \d events
                             Table "public.events"
   Column    |              Type              | Collation | Nullable | Default
-------------+--------------------------------+-----------+----------+---------
 id          | uuid                           |           | not null |
 type        | character varying(255)         |           | not null |
 data        | jsonb                          |           | not null |
 thread_id   | uuid                           |           | not null |
 user_id     | uuid                           |           | not null |
 inserted_at | timestamp(0) without time zone |           | not null |
 updated_at  | timestamp(0) without time zone |           | not null |
Indexes:
    "events_pkey" PRIMARY KEY, btree (id)
    "events_thread_id_index" btree (thread_id)
    "events_user_id_index" btree (user_id)
Foreign-key constraints:
    "events_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    "events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
Referenced by:
    TABLE "facts" CONSTRAINT "facts_source_event_id_fkey" FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE CASCADE
    TABLE "facts" CONSTRAINT "facts_tool_use_event_id_fkey" FOREIGN KEY (tool_use_event_id) REFERENCES events(id) ON DELETE CASCADE
Publications:
    "electric_publication_default"
```

There are no extensions or vectors. It's just standard rows in standard tables.

### Phoenix.Sync

On the backend, Burn uses the [Phoenix framework](https://www.phoenixframework.org).

Phoenix is built in [Elixir](https://elixir-lang.org), which runs on the [BEAM](https://blog.stenmans.org/theBeamBook/). The BEAM provides a robust agentic runtime environment with built-in primitives for [process supervision and messaging](https://hexdocs.pm/elixir/processes.html).

This makes Elixir and Phoenix a perfect match for agentic system development [without needing a seperate agent framework](https://goto-code.com/blog/elixir-otp-for-llms/).

Phoenix also has a sync library, [Phoenix.Sync](https://hexdocs.pm/phoenix_sync), that adds real-time sync to Phoenix:

<figure>
  <div style="aspect-ratio: 16/9" class="embed-container">
    <YoutubeEmbed video-id="rlzL5wnWa9o" />
  </div>
</figure>

Burn uses Phoenix.Sync to sync data out of Postgres, into both the back-end (for agents) and the front-end (for users). Specifically, the app syncs data about threads and memberships into an [agent process supervisor](https://github.com/electric-sql/electric/burn/blob/main/examples/burn/lib/burn/agents/supervisor.ex). This handles database change events by spinning-up and tearing-down agent processes at runtime.

```elixir
# From `lib/burn/agents/supervisor.ex`

def init(_opts) do
  {:ok, supervisor} = DynamicSupervisor.start_link(strategy: :one_for_one)
  {:ok, _consumer} = DynamicSupervisor.start_child(supervisor, %{
    id: :membership_consumer,
    start: {Task, :start_link, [&sync_memberships/0]},
    restart: :permanent
  })

  {:ok, %{supervisor: supervisor}}
end

def handle_info({:stream, :memberships, messages}, state) do
  # Stop process when agent membership deleted
  messages
  |> Enum.filter(&Messages.is_delete/1)
  |> Enum.map(&Messages.get_value/1)
  |> Enum.map(&preload_associations/1)
  |> Enum.filter(&is_agent_membership?/1)
  |> Enum.each(&stop_agent(&1, state))

  # Start process when agent membership inserted
  messages
  |> Enum.filter(&Messages.is_insert/1)
  |> Enum.map(&Messages.get_value/1)
  |> Enum.map(&preload_associations/1)
  |> Enum.filter(&is_agent_membership?/1)
  |> Enum.each(&start_agent(&1, state))

  {:noreply, state}
end
```

This gives us a resilient, scalable, distributable, dynamic supervision tree of agent processes that scales up and down in sync with the contents of the database.

Each agent process then subscribes to the data and events in their thread:

```elixir
# From `lib/burn/agents/agent.ex`

def init({%Threads.Thread{} = thread, %Accounts.User{type: :agent} = agent, mode}) do
  {:ok, supervisor} = Task.Supervisor.start_link()

  shapes = [
    {:events, start_shape(thread, :events)},
    {:memberships, start_shape(thread, :memberships)},
    {:thread, start_shape(thread, :thread)}
  ]

  Enum.each(shapes, fn {key, shape} ->
    Task.Supervisor.start_child(
      supervisor,
      fn -> Consumer.consume(self(), key, shape) end,
      restart: :permanent
    )
  end)

  # ...
end
```

When a new event is stored in the database (such as a user joining the thread, posting a message or another agent performing a tool call), the agent instructs the LLM using the Anthropic API. The LLM responds with a tool call. If performing the tool call generates new events, the agents detect them and the loop goes round again.

So that's how Phoenix.Sync is used to drive the agentic control flow in the back-end. It's also used to sync data into the front-end, by exposing sync endpoints in the router.

```elixir
# From `lib/burn_web/router.ex

defmodule BurnWeb.Router do
  use BurnWeb, :router

  # ...

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :auth do
    plug :fetch_api_user
    plug :require_authenticated_user
  end

  scope "/sync" do
    pipe_through [:api, :auth]

    sync "/users", Accounts.User
    sync "/threads", Threads.Thread
    sync "/memberships", Threads.Membership
    sync "/events", Threads.Event
    sync "/facts", Memory.Fact
  end
end
```

In the front-end, we wire these sync endpoints into [TanStack DB collections](/blog/2025/07/29/local-first-sync-with-tanstack-db#collections).

### TanStack DB

[TanStack](https://tanstack.com) is a popular library for building web and mobile apps. TanStack DB is a new reactive client store built into TanStack for [building super fast apps on sync](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query).

You can read more about using TanStack DB with Electric on our [Local-first sync with TanStack DB and Electric](/blog/2025/07/29/local-first-sync-with-tanstack-db) blog post. It's a client store that provides a collection primitive to sync data into and a reactive, local-first programming model based on live queries and transactional mutations.

<div class="listing">
  <BlogPostListing v-for="post in posts"
      :key="post.slug"
      :post="post"
  />
</div>

Burn defines TanStack DB collections which map to the sync endpoints we saw above, exposed in the Router:

```ts
// From `assets/src/db/collections.ts`

export const eventCollection = createCollection(
  electricCollectionOptions({
    id: 'events',
    shapeOptions: {
      url: relativeUrl('/sync/events'),
      ...baseShapeOptions,
    },
    schema: eventSchema,
  })
)

export const userCollection = createCollection(
  electricCollectionOptions({
    id: 'users',
    shapeOptions: {
      url: relativeUrl('/sync/users'),
      ...baseShapeOptions,
    },
    schema: userSchema,
  })
)
```

Electric collections use the [Electric sync engine](/product/electric) (in this case via Phoenix.Sync) to keep the data in the collection up-to-date and in-sync with the contents of the Postgres database. Components then read data from the collections using live queries:

```tsx
// From `assets/src/components/ChatArea.tsx`

import { useLiveQuery, eq } from '@tanstack/react-db'
import { eventCollection, userCollection } from '../db/collections'

function ChatArea({ threadId }: Props) {
  const { data: events } = useLiveQuery(
    (query) => (
      query
        .from({ event: eventCollection })
        .innerJoin({ user: userCollection }, ({ event, user }) =>
          eq(user.id, event.user_id)
        )
        .orderBy(({ event }) => event.inserted_at, {
          direction: 'asc',
          nulls: 'last'
        })
        .where(({ event }) => eq(event.thread_id, threadId)
    ),
    [threadId]
  )
```

Live queries are reactive and built on a [super-fast, query engine](/blog/2025/07/29/local-first-sync-with-tanstack-db#sub-millisecond-performance), based on a [Typescript implementation of differential dataflow](https://github.com/electric-sql/d2ts). Data syncs through into the collections, incrementally updates the live queries and everything just reacts. Instantly. Across all users and all devices.

<figure>
  <div class="embed-container" style="padding-bottom: 62.5%">
    <YoutubeEmbed video-id="_5__QSphP24" />
  </div>
</figure>

### 𝑓(state)

The key thing making this work is that the events driving the thread and the facts being stored in the "agentic memory" are just normal rows in the database.

To illustrate this, Burn renders not only a normal, collaborative chat UI for the main user <> agent interaction but also a "computer" sidebar on the right hand side, showing you the raw data in the database that the thread is running on.

The memory collects facts in the database. The facts sync into the front-end, where they're displayed in real-time in the memory listing in the computer sidebar. Then the "context" section below that show the events that are driving the thread.

<figure>
  <div class="embed-container" style="padding-bottom: 75.842697%">
    <YoutubeEmbed video-id="qEs8ITbb1ZA" />
  </div>
</figure>

Both UIs (the main chat UI and the computer sidebar) are functional representations of the database state. But then so is the instruction sent to the LLM. When an agent instructs the LLM, it retrieves the state of the current thread and renders in it a text format that the LLM likes.

```
Here's everything that happened so far:

<system_message>
  action: created
  target: thread
  user:
    id: c15d31e2-b3ee-4ca6-b90b-1596d739d4fd
    name: thruflo
</system_message>

<ask_user_about_themselves>
  from: d4351246-7a34-4a29-9c5e-367fb348b08c
  id: toolu_01YQMvbaLA3f4stDjNHzPT3F
  input:
    question: What's something you're particularly passionate about or spend most of your free time doing?
    subject: c15d31e2-b3ee-4ca6-b90b-1596d739d4fd
  name: ask_user_about_themselves
</ask_user_about_themselves>

<user_message>
  from: c15d31e2-b3ee-4ca6-b90b-1596d739d4fd
  id: cea5082a-4e13-4dac-b418-9c2d78d5d2ee
  text: I like chess and cooking
</user_message>

<extract_facts>
  from: d4351246-7a34-4a29-9c5e-367fb348b08c
  id: toolu_01RQV95gUkfKAkuByBv1bFPB
  input:
    facts:
      -
        category: hobby
        confidence: 0.9
        disputed: false
        object: chess
        predicate: likes
        source_event: cea5082a-4e13-4dac-b418-9c2d78d5d2ee
        subject: c15d31e2-b3ee-4ca6-b90b-1596d739d4fd
      -
        category: hobby
        confidence: 0.9
        disputed: false
        object: cooking
        predicate: likes
        source_event: cea5082a-4e13-4dac-b418-9c2d78d5d2ee
        subject: c15d31e2-b3ee-4ca6-b90b-1596d739d4fd
  name: extract_facts
</extract_facts>

What's the next step?
```

This retrieval and rendering process _is_ the context engineering behind the system. It's all just a functional representation of database state.

<figure>
  <div class="embed-container" style="padding-bottom: 56.25%">
    <YoutubeEmbed video-id="sUpFc9qO0jA" />
  </div>
</figure>

## Back down to earth

There's a lot of hype around agentic system development. Concepts like agentic memory, instruction routing, retrieval and context engineering.

When you dig into it, these all collapse down to processes and database state. You can build agentic systems with a database, standard web tooling and real-time sync.

See the [🔥 Burn demo app](/demos/burn) and [source code](https://github.com/electric-sql/electric/tree/main/examples/burn) for an example and build your own agentic system with [Phoenix.Sync](https://hexdocs.pm/phoenix_sync) and [TanStack DB](https://tanstack.com/db).

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta hidden-sm">
    <VPButton
      href="/demos/burn"
      text="Burn demo app"
      theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://hexdocs.pm/phoenix_sync"
        text="Phoenix.Sync"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/db"
        text="TanStack DB"
        theme="alt"
    />
  </div>
  <div class="action cloud-cta hidden-xs block-sm">
    <VPButton
      href="/demos/burn"
      text="Burn"
      theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://hexdocs.pm/phoenix_sync"
        text="Phoenix.Sync"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/db"
        text="TanStack DB"
        theme="alt"
    />
  </div>
  <div class="action cloud-cta block-xs">
    <VPButton
      href="/demos/burn"
      text="Burn"
      theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://hexdocs.pm/phoenix_sync"
        text="Phoenix"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/db"
        text="TanStack"
        theme="alt"
    />
  </div>
</div>
