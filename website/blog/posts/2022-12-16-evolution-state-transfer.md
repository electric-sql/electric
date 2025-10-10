---
title: "The evolution of state transfer"
description: >-
  Web development has been progressing through an evolution of state transfer. Hybrid local-first architecture is the natural endgame for this progression.
excerpt: >-
  Web development has been progressing through an evolution of state transfer. Local-first is the natural endgame and the vision we're working towards with Electric.
featured: true
authors: [thruflo]
image: /img/blog/evolution-state-transfer/listing.png
tags: [local-first]
outline: deep
post: true
---

<script setup>
import Tweet from 'vue-tweet'
</script>

Web development has been progressing through an evolution of state transfer. Local-first is the natural endgame and the vision we're working towards with Electric.

State transfer is fundamental to online applications. Web apps are architected around the network, with the separation of front-end from back-end and protocols like AJAX and REST. However, newer protocols like GraphQL and frameworks like Remix are increasingly abstracting state transfer away from application code.

[Local-first software](https://www.inkandswitch.com/local-first/) is a new paradigm that fully abstracts state transfer out of the application domain. It's the endgame for the evolution of state transfer and the vision we're building towards with [ElectricSQL](/).

<div class="my-6 mt-8">
  <figure class="figure mx-0 my-3">
    <a href="/img/blog/evolution-state-transfer/electricsql-evolution-state-transfer.jpg"
        class="relative block text-center w-full no-visual"
        target="_blank">
      <img src="/img/blog/evolution-state-transfer/electricsql-evolution-state-transfer.jpg"
          class="figure-img img-fluid mx-auto"
      />
    </a>
  </figure>
  <figcaption class="figure-caption text-end text-small mb-3 mb-9 max-w-lg ml-auto">
    Table summarising the evolution of state transfer from form-POST through AJAX, REST and GraphQL to local-first.
  </figcaption>
</div>

## Forms to GraphQL

State transfer on the web started with HTTP POSTs. Data was rendered server-side into the page. Users interacted with a form. When they pressed submit, the form data was `application/x-www-urlencoded` and sent to the server as the body of an HTTP POST request.

That's how state was initially transferred on the web: explicitly and imperatively, as part of a whole page reload, directly in response to user input. This changed the world. But developers chafed against the whole page reload model.

### Invention of AJAX

In 1998, the Microsoft Outlook team invented the `XMLHttpRequest` and, the year after, snuck it into Internet Explorer 5.0. All the browsers followed and the era of AJAX was born, driven by apps like Gmail and Google Maps. With AJAX, the developer can choose when and how to POST data to the server, without coupling state transfer to page reloading.

This led to the web becoming a first-class platform for interactive applications. However, posting and handling random fragments of data was complex and arbitrary. Developers looked to standardise and AJAX converged on JSON and REST.

### Standardising on REST

The combination of [JSON](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON) and [REST](https://restfulapi.net) brought a common pattern for API design and asynchronous state transfer. If Twitter is to be believed, REST is still the most popular method of state transfer today:

<div class="mt-4 pb-4">
  <Tweet tweet-id="1599690320865681409"
      align="center"
      conversation="none"
      theme="dark"
  />
</div>

REST helps with scalability and simplifies backend development. By standardising the protocol, REST also introduced the potential for automatic API generation. For example, [Swagger](https://swagger.io) allows documentation and client libraries to be generated from a REST API specification. Frameworks like [Remix](https://remix.run) automatically create APIs based on client code.

Standardisation was good but unfortunately, REST was a sub-optimal pattern for fetching data. It often requires multiple requests to load a state. It also often loads more data than is needed, as REST endpoints typically return a representation of the whole resource, even if you're only actually using part of it.

### Enter GraphQL

In 2015, Facebook released [GraphQL](https://graphql.org) and the accompanying [Relay framework](https://relay.dev). One of the main design goals for GraphQL was to fix the data fetching weaknesses in REST:

1. by minimising the number of requests an app needs to fetch data to render a page; and
2. by optimising the exact data shape that's fetched to avoid loading unnecessary data

With GraphQL, each component in the hierarchy declares the exact data shape (the "fragment" of data) it requires. Relay then aggregates and normalises the fragments into a single top-level query. This optimises both the number of network requests and the shape of the data that's returned.

For example, imagine a page on a website that displays information about a book and uses a sub-component to display the author's bio. With GraphQL, you would define a query for your top-level page component and include in it the fragment of data needed by the sub-component displaying the author:

```graphql
query BookQuery($bookID: ID!) {
  book(id: $bookID) {
    title
    author {
      ...AuthorDetails_author
    }
  }
}

fragment AuthorDetails_author on Author {
  name
  photo {
    url
  }
}
```

Relay then populates the shape of the query by aggregating the fragments. So the page actually fetches:

```graphql
{
  book {
    title
    author {
      name
      photo {
        url
      }
    }
  }
}
```

As you can see, GraphQL is declarative. As a developer, you define the data your components need and the system takes care of:

1. transferring the data across the network; and
2. minimising the data transferred to just the shape that the app actually uses

This was a huge step forward towards both abstracting out and optimising state transfer. However, the protocol is still designed around the network: optimising that big resolve upfront. The developer explicitly controls how the data is fetched and where from using [fetch policies](https://relay.dev/docs/guided-tour/reusing-cached-data/fetch-policies/).

Writes are also still imperative by default. [Optimistic writes are more declarative](https://relay.dev/docs/guided-tour/updating-data/imperatively-modifying-store-data-unsafe/#optimistic-updaters-vs-updaters) but they introduce the need for code to be written to cope with rollbacks. As you can see from the signature of the core [commitMutation API](https://relay.dev/docs/api-reference/commit-mutation):

```ts
commitMutation(
  environment: Environment,
  config: {
    mutation: GraphQLTaggedNode,
    variables: {[name: string]: mixed},
    onCompleted?: ?(response: ?Object, errors: ?Array<PayloadError>) => void,
    onError?: ?(error: Error) => void,
    optimisticResponse?: Object,
    optimisticUpdater?: ?(store: RecordSourceSelectorProxy) => void,
    updater?: ?(store: RecordSourceSelectorProxy, data: SelectorData) => void,
    configs?: Array<DeclarativeMutationConfig>,
    cacheConfig?: CacheConfig,
  },
);
```

Ultimately, with GraphQL, the concerns of the state transfer layer find their way back into application code, in the form of error handlers, imperative mutations and fetch policy semantics. By contrast, [local-first](https://www.inkandswitch.com/local-first/) has the potential, as a paradigm, to fully abstract out state transfer, without leaking concerns from the networking layer back into the application code.

## Local-first

With local-first, developers code directly against a local, embedded database. Reads and writes are instant. Users can still share data and collaborate but the state transfer happens in the background, with reads and writes made against the local database and then synced in the background to the server.

Just as with GraphQL, you define rules for what data can be synced and you bind data declaratively to your components. However, unlike GraphQL, you don't need to wait on the network to confirm your writes or configure fetch policy semantics. As a web developer, you can craft realtime, multi-user apps *without thinking about or coding around the network*.

For example, with ElectricSQL, you swap out the GraphQL `useQuery` hook for `useElectricQuery` and the results are automatically kept in sync, no matter who edits the `items` table, anywhere in the world. Because SQL is a declarative language and you're querying an embedded SQLite database, you don't need the graph abstraction, or the additional resolver layer mapping from relational tables to the GraphQL schema.

```jsx
const ExampleComponent = () => {
  const { results } = useElectricQuery('SELECT value FROM items', [])

  return (
    <View>
      {results.map((item, index) => (
        <Text key={ index } style={styles.item}>
          Item: { item.value }
        </Text>
      ))}
  )
}
```

Importantly, the results that the system keep in sync come from the local database. The system doesn't aggregate and fetch data for you when your components render. It simply talks to the embedded local database. So you can be sure the application functions even if the network is down or the backend is down and you can rely on consistent, super fast (often sub-millisecond) query times.

When local-first is done right, developers can create reactive, realtime, multi-user apps without having to worry about the network and its various failure modes. It's entirely up-to the database replication system how and when to transfer data. As a result, local-first brings state transfer fully into the domain of the database. With all of the associated rigour around [consistency and integrity](https://legacy.electric-sql.com/docs/reference/consistency) that you easily lose when working with the data in your application code.

With the [right system and concurrency semantics](/blog/2022/05/03/introducing-rich-crdts), you can also write locally with *finality* as opposed to *tentativity*. I.e.: with the certainty that your writes will not be rejected once they've been accepted locally <sup>[1]</sup>. Instead of having to implement both the `updater` and `optimisticUpdater` callbacks of the GraphQL `commitMutation` API we saw above, you simply write to the local database and if your write succeeds locally, you're done.

> <span class="text-small">[1]</span> See the [Highly Available Transactions](https://doi.org/10.14778/2732232.2732237) and [Cure](https://doi.org/10.1109/ICDCS.2016.98) papers, both listed on our [literature&nbsp;page](/docs/reference/literature).

### Optimal placement and movement of data

> "There are no solutions. There are only trade-offs."<br />
> — Thomas Sowell (via [evoluhq/evolu](https://github.com/evoluhq/evolu#trade-offs))

There are, of course, constraints with local-first. Concurrent writes are subject to merge semantics, so you have to become comfortable with the [reality of a relativistic universe](/blog/2022/05/20/relativity-causal-consistency).

Device constraints also mean that you often can't have the whole database synced onto the device. As a result, you still need a "hybrid" architecture where the cloud underpins local-first applications. Not only to provide durability and sync but also to load data into the local app &mdash; both on first run and as the shape of the data needed on the device changes.

This hybrid architecture has a number of layers, from central cloud to the end user device:

1. central cloud storage, such as [AWS Aurora](https://aws.amazon.com/rds/aurora)
2. multi-region geo-distributed storage, such as [PolyScale](https://polyscale.ai)
3. serverless cloud edge, such as [Fauna](https://fauna.com) and [Neon](https://neon.tech)
4. local databases on device, such as [SQLite](https://www.sqlite.org) and [DuckDB](https://duckdb.org)

Managing the placement and movement of data across these layers, [from cloud to edge to local devices](https://dl.acm.org/doi/abs/10.1145/3464298.3493405), is complex. Too complex to be optimised by hand. It needs to be managed and optimised by the system. I.e.: rather than imperatively placing data onto locations in your cloud architecture, you need to declare your requirements and optimisation parameters and have the cloud handle the rest.

> "As cloud programming matures, it seems inevitable that it will depart from traditional sequential programming. The cloud is a massive, globe-spanning distributed computer. Parallelism abounds at all scales. Creative programmers are held back by legacy programming models. [What's needed] is a separation of distributed programs into program semantics, availablity, consistency and targets of optimization.<br />
> &mdash; [New Directions in Cloud Programming, Joe Hellerstein, et al.](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper16.pdf)

This is the endgame of state transfer: where the combination of static programme analysis and AI not only optimises the *transfer* of data from point to point, but also the *placement* of data and where the *points* and *layers* are in the first place.

### Inspiration for ElectricSQL

Web development has been progressing through an evolution of state transfer from manual, imperative data transfer towards automated, declarative systems. Hybrid local-first architecture is the natural endgame for this progression. That's what we're building with Electric. A framework where you can declare what data *can* sync and what data your components *need* and the system takes care of the rest.

Where state transfer is fully abstracted into the database layer. Where it can be optimised for consistency, integrity, placement and latency and you never have to write a rollback handler or inspect an HTTP status code, ever again.
