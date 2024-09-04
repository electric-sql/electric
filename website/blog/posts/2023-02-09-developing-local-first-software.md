---
title: "Developing local-first software"
description: >-
  Exploring the key differences and trade-offs between building local-first vs cloud-first apps.
excerpt: >-
  Local-first software is the natural evolution of state-transfer. It enables a modern, realtime multi-user experience, with built in offline support, resilience, privacy and data ownership.
featured: true
authors: [thruflo]
image: /img/blog/introducing-electric-sql/listing.png
tags: [local-first]
outline: deep
post: true
---

[Local-first software](https://www.inkandswitch.com/local-first) is the future. It's the [natural evolution of state-transfer](/blog/2022/12/16/evolution-state-transfer). It enables a modern, realtime multi-user experience, with built in offline support, resilience, privacy and data ownership. You get instant reactivity and a network-free interaction path. Plus it's much cheaper to operate and scale.

<!--truncate-->

There's a [range of local-first tooling](/docs/reference/alternatives) now emerging. Not just [Electric](https://electric-sql.com) but also projects like [Evolu](https://github.com/evoluhq/evolu), [Homebase](https://homebase.io), [Instant](https://www.instantdb.com), [lo-fi](https://github.com/a-type/lo-fi), [Replicache](https://replicache.dev), [sqlite_crdt](https://github.com/cachapa/sqlite_crdt) and [Vlcn](https://vlcn.io). With these, and others, local-first is becoming more accessible. However, it's still a fundamentally different paradigm. You code directly against a local, embedded database. Your data access code runs in an untrusted environment. You have to work within the limitations of what you can store and sync onto the device -- and what your users allow you to sync off it.

This post aims to walk through the key differences and trade-offs, from working directly against a local database to the challenges of concurrent writes, partitioning and partial replication.


## Cloud-first vs local-first

Cloud-first systems are the status quo. You have a backend and a frontend. State transfer protocols like REST, GraphQL and LiveView manage how data moves across the network. You typically need online connectivity to confirm writes. Systems are mainly integrated and monetised in the cloud.

Local-first systems are different. You replace your backend with a sync system and write application code that reads and writes data directly to and from a local database. Applications naturally work and support writes offline. State transfer moves into the database layer.

This model has huge benefits. You eliminate APIs and microservices and [cut out the boilerplate associated with imperative state transfer](/blog/2022/12/16/evolution-state-transfer). However, on the flip side, you need to move your business logic into the client, codify your auth and validation logic in security rules and hang your background processing off database events.

### Security rules

When you have a backend application, you can have controllers and middleware on the write path. This gives you a (relatively!) trusted environment to run arbitrary auth and validation code. For example, here's an Elixir [Plug](https://hexdocs.pm/plug/Plug.html) performing arbitrary logic and whatever database calls are behind the `Accounts.is_admin?(user)` to enforce that users must be admins:

```elixir
defmodule RequireAdminPlug do
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    user = conn.assigns.current_user

    case Accounts.is_admin?(user) do
      true ->
        conn

      false ->
        conn
        |> Conn.put_status(403)
        |> Conn.halt()
    end
  end
end
```

When you go local-first, you can't write middleware like this because there's nowhere to run it. You write directly to the database in the client. As a result, you need to codify that logic into some kind of rule system, like [Firebase Security Rules](https://firebase.google.com/docs/rules/) or [Postgres row-level security (RLS)](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). For example, the following SQL uses row-level security to enforce that only admins can access items:

```sql
CREATE TABLE items (
  value text PRIMARY KEY NOT NULL
);
ALTER TABLE items
  ENABLE ROW LEVEL SECURITY;

CREATE ROLE admin;
GRANT ALL ON items TO admin;
```

This is an example of transposing auth logic into security rules. But, actually, row-level security is typically *not* what you need for local-first applications. Because with standard RLS the user is set by the database connection string and the rules are scoped to tables. Instead, what you need is to connect the rules to the end-user of the application and to the context in which the data is being loaded through.

For example, [Supabase extends RLS](https://supabase.com/docs/guides/auth/row-level-security) with an `auth` context. This allows rules to be connected to the end-user of the application, rather than the user in the database connection string:

```sql
CREATE TABLE items (
  value text PRIMARY KEY NOT NULL,
  owner_id uuid references auth.users
);
ALTER TABLE items
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can update items"
  ON items FOR UPDATE USING (
    auth.uid() = owner_id
  );
```

You also want to codify different things. Traditional database access rules tend to be used in modern web and mobile applications for quite blunt, high level permissions. Like limiting the rights of the backend application. Whereas what you want with local-first systems is to codify the type of high level business logic normally implemented in controllers and middleware. Like the Plug code we saw above.

This logic can be quite flexible, often makes database queries and uses information that's available on the request. In Supabase's system, you model this using the `auth` context in place of the request and SQL queries to emulate the business logic. In [Firebase's rules language](https://firebase.google.com/docs/rules/rules-language), you have similar access to the auth context from a `request` object and the traversal context in a `resource` object:

```jsx
service cloud.firestore {
  match /databases/{database}/documents {
    function signedInOrPublic() {
      return request.auth.uid != null || resource.data.visibility == 'public';
    }

    match /items/{item} {
      allow read, write: if signedInOrPublic();
    }
  }
}
```

One of the key requirements of these rules systems is the ability to bootstrap new permission scopes without having to use external privileged business logic or APIs. For example, you may want the creator of a new resource to be assigned particular access permissions. In the Supabase policy example above, the `items` table has a `owner_id` field. By writing the id of the user that creates the item into the field, you can bootstrap special permissions for them.

We support this in the [ElectricSQL DDLX rules](/docs/api/ddlx) using `GRANT` and `ASSIGN`, for example:

```sql
ELECTRIC GRANT ALL
  ON projects
  TO 'projects:owner';

ELECTRIC ASSIGN 'projects:owner'
  TO projects.owner_id;
```

See [Usage -> Data Modelling -> Permissions](/docs/usage/data-modelling/permissions) and the [API -> DDLX](/docs/api/ddlx) spec for more information.

### Business logic

As we've said above, cloud-first software has a backend layer where you can run abitrary business logic. Going local-first, you cut out this layer. So your logic needs to either run in the client, or be run in response to database change events. This impacts your system design, data model and programme semantics.

For example, this is a simple backend function that could be called by a controller to sign a user up and send a verification email:

```elixir
def sign_up(user) do
  user
  |> Repo.insert!()
  |> Mailer.send_verification_email()
end
```

This function would either need to be ported to the client side or split between client and backend data change event handler. In the client, the code can't be trusted. A malicious user could change it or avoid calling it. It's also often tricky to have secrets, such as a mailing service API key, available in the frontend. You can't serve them in your javascript and you can't bundle them into your app.

So you have to switch to running background processes using event handler code that's triggered by database change events. For example:

```elixir
def handle_event(%Insert{row: inserted_user}) do
  inserted_user
  |> Mailer.send_verification_email()
end
```

### Event sourcing

To achieve this, you need to hook into the database changes. This can be done using database triggers or replication. For example, [Postgres LISTEN/NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) and [logical replication](https://www.postgresql.org/docs/current/logical-replication.html). Or higher level systems that map events to function handlers, like [Firebase function triggers](https://firebase.google.com/docs/functions/database-events#trigger_a_function). There are also systems like [Materialize](https://materialize.com) that provide very flexible tooling for processing event streams.

For example to put Postgres changes onto a Kafka topic:

```sql
-- Consume PG logical replication.
CREATE SOURCE pg_items
  FROM POSTGRES CONNECTION pg_connection (
    PUBLICATION 'pub'
  )
  FOR TABLES ('items');

-- Optionally aggregrate, subset or transform.
CREATE MATERIALIZED VIEW items AS
  SELECT owner_id, value
  FROM pg_items;

-- Put onto the Kafka topic.
CREATE SINK avro_sink
  FROM items
  INTO KAFKA CONNECTION kafka_connection (
    TOPIC 'topic'
  )
  FORMAT AVRO USING CONFLUENT SCHEMA
  REGISTRY CONNECTION conn
  ENVELOPE UPSERT;
```

See [Integrations -> Event sourcing](/docs/integrations/event-sourcing) for more information.

## Coding against a local database

With local-first, your client-side application code works directly with a local, embedded database. This is why local-first apps feel instant and work offline: because you read and write data without going over the network. However, there are limits to what you can store and sync on and off the local device.

This impacts your ability to query data. Because you can't query data that isn't there. And you need to use live queries to adapt to the way that data can change underneath you.

### What you can sync

Local devices (computers, laptops and mobile phones) have limited storage space, memory, compute and battery power. There are databases that you *can* fully store and sync onto the device. For example, the database for a shared family shopping list application. However, many real world applications have large databases that you *can't* fit onto the device.

Depending on data size and network connectivity, it can take a lot of time to transfer data. You have the "cold start" sync time, when you first run an application and sync initial data in from the cloud. You also often need to resume and restart replication when devices come back online. Over time, you need to remove data as well as add it. For example, imagine you have a weather application that always syncs the latest weather. At some point, you probably want to remove weather from the past, to avoid filling up the hard drive.

You also have changes in runtime info and / or security rules that require re-syncing data. The kind of rules we were writing above to control who can see what data were using the `auth` context. What happens when this changes? Or what happens when you change your security policy? It takes time (and connectivity) to handle to these runtime changes and adapt to the new shape of data that should be synced onto the device.

### What you can query

With cloud-first systems, it tends to be fine to query any part of the data that's held in the central cloud database. For example, you might have a table with a million `projects` that the user can query by id or search term, e.g.:

```sql
-- Query by id.
SELECT * FROM projects
  WHERE id = $1

-- Query by search term.
SELECT * FROM projects
  WHERE name LIKE $1
```

The cloud database checks its index (or does a sequence scan) and returns the query result. It's not a problem to expose that query capability. The cloud can handle any id or search term.

With local-first, you run your queries on the device. As we saw above, you often can't sync the whole `projects` table onto the local device. Plus there are access considerations. Different projects belong to different accounts. As a user, you should only be able to see the projects you have access to. So you can't have the whole projects table synced onto your device.

Which raises the question, how *do* you make a local first app where you can query across projects? The answer lies in the solution your sync system provides for dynamic partial replication.

### Dynamic partial replication

As we've seen in the security rules section above, data replication should be controlled and filtered by security rules, runtime parameters and client connection state. If you need to load just the public information that's required to see project listings you should be able to do that. That's *partial* replication.

If you need to be able to "open up" and sync in a project, you need to be able to add it to the set of data that's synced onto your local device. That's *dynamic* partial replication: where the shape of the partially replicated set of data changes over time. Some systems, like Postgres logical replication, require explicit rule changes to update what syncs:

```sql
ALTER PUBLICATION example
  ADD TABLE users;
```

Other systems, like [Mongo Atlas Flexible Sync](https://www.mongodb.com/docs/atlas/app-services/sync/configure/sync-settings/) sync whatever is in your queries. Other systems, like [Replicache](https://replicache.dev/#how), sync blocks of data whenever you touch them.

How your system does this is crucial to the development model. How you partition and segment your data model to work with the way the replication system does this is critical to your application design and your user experience. Ideally, the system should also be able to optimise data transfer and placement for you.

ElectricSQL has an expressive [Shape-based system](/docs/usage/data-access/shapes) for dynamic partial replication. This allows you to sync subsets of data that sync on and off the local device. In this example, the `where` clause filters which projects you want to sync and then the `include` tree is like an association graph that pulls in the related data that belongs to the project:

```tsx
const shape = await db.projects.sync({
  where: {
    owner_id: user_id
  },
  include: {
    issues: {
      include: {
        comments: {
          include: {
            author: true
          }
        }
      }
    }
  }
})
```

Shapes can adapt runtime to authentication state, routing parameters, etc. Which allows you to optimise the way data loads onto the local device and is available for offline interactivity. See [Usage -> Data access -> Shapes](/docs/usage/data-access/shapes) for more information.

### Live changes

Because local-first provides multi-user sync, the local user is not the only one writing to the local database. When you're connected, changes can stream in over the background replication. So if you're binding queries to a reactive component, for example something like:

```tsx
const ExampleComponent = () => {
  const results = db.items.findMany()

  return (
    /* render results */
  )
}
```

You need to keep the `results` in sync with the underlying database. That way, when the data changes, your components re-render in realtime. This means that instead of binding the results of a static query to your component, you bind a *live query* that automatically updates the `results` whenever the underlying data changes.

For example, [Evolu](https://github.com/evoluhq/evolu) provides a React `useQuery` hook. In this case, `rows` is a React state variable that's kept in sync by the local-first client library with and changes made to the underlying database:

```tsx
const ExampleComponent = () => {
  const { rows } = useQuery((db) => db.selectFrom("items")

  return (
    /* render rows */
  )
);
```

ElectricSQL provides a similar [live query abstraction](/docs/usage/data-access/queries). For example:

```tsx
const ExampleComponent = () => {
  const { db } = useElectric()!
  
  const { results } = useLiveQuery(
    db.projects.liveMany({
      where: {
        // ...
      }
    })
  )

  return (
    /* render rows */
  )
);
```

:::note
The algorithm(s) that your or your framework uses for keeping the results in sync and the size of your data and result-sets can have a major impact on performance (the responsiveness of your app) and battery life. The Riffle paper on [Building data-centric apps with a reactive relational database](https://riffle.systems/essays/prelude/) has a good description of some of the challenges and considerations around reactivity and performance.
:::

## Embracing causal consistency

Distributed systems tend to be framed in terms of the [CAP Theorem](https://en.wikipedia.org/wiki/CAP_theorem) and the [consistency models](https://jepsen.io/consistency) they can provide. With local-first, devices need to accept writes when offline and can be offline ("partitioned") for weeks. This dictates that local-first systems can't use consensus or coordination to maintain consistency. So they have to embrace eventual consistency and come at things from the AP side of the CAP Theorem.

The good news is that [recent advances in the research base](/docs/reference/literature) have strengthened the guarantees that AP systems can provide. Specifically, it's now possible to build systems that provide transactional atomicity, causal consistency and conflict free merge semantics using [CRDTs](https://crdt.tech). This provides a much stronger programming model that weak eventual consistency. With Electric, we build on it to also provide referential integrity and constraints using [Rich-CRDTs](/blog/2022/05/03/introducing-rich-crdts).

However, application developers still need to accept that writes can be made concurrently and that data may therefore "move around" underneath you. There are different approaches to this. You can reject conflicting writes, leading to rollbacks. Or you can always merge writes in. This allows you to write with *finality* and avoid rollbacks but updates may still be "built on" by concurrent writes made elsewhere.

This can result in data states that are unexpected if you're used to thinking about strongly consistent systems with a total order. So it's important to adopt the mindset of [causal consistency](/docs/reference/consistency) in what is essentially a [relativistic universe](/blog/2022/05/20/relativity-causal-consistency).


## Putting it all together

Hopefully this has been a useful walk through some of the design and architectural considerations to bear in mind when adopting and building local-first. Essentially, you need to codify auth, filtering and validation into database security rules. Bind live queries to your components in the client application. Write directly to the local database and use event sourcing to trigger server-side workflows. As a result you get modern, realtime multi-user experience, with built in offline support, resilience, privacy and data ownership.

If you're interested in local-first development, you can get started right now with our [Introduction](/docs/quickstart) and [Quickstart](/docs/quickstart) guides.
