---
title: Untangling the LLM spaghetti
description: >-
  LLMs are generating code. That code is imperatively fetching data. That
  leads to a big ball of spaghetti.
excerpt: >-
  LLMs are generating code. That code is imperatively fetching data. That
  leads to a big ball of spaghetti.
authors: [thruflo]
image: /img/blog/untangling-llm-spaghetti/header.jpg
tags: [ai, sync]
outline: [2, 3]
post: true
---

LLMs are generating code. That code is imperatively fetching data. That leads to a big ball of spaghetti.

For example, [Bolt](https://bolt.new) and [Lovable](http://lovable.dev) use Supabase, generating code like this:

```js
const fetchTodos = async () => {
  try {
    setLoading(true);
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    setTodos(data || []);
  } catch (error) {
    console.error('Error fetching todos:', error);
  } finally {
    setLoading(false);
  }
};
```

This code is imperative. It's a function inlined into a React component that's called when the component mounts.

You see the problem already. The more components like this you generate, the more requests are made. More loading spinners, more waterfall, more failure modes. More stale data when components don't re-fetch on update.

It's a big ball of spaghetti.

So what's the solution? Declarative data dependencies and sync engine. So that the network requests, the actual data fetching, can be delegated to a system that optimises data transfer and placement for you.

Start with a logical data model. Your LLM understands that. It will generate and evolve a schema for you. Then, instead of generating code to imperatively fetch data, generate code that *declares* the data that your component needs.

[GraphQL](https://relay.dev/docs/tutorial/fragments-1/) does it with fragments and an aggregated top-level fetch:

```js
export const TodoFragment = graphql`
  fragment TodoFragment on Todo {
    id text
    complete createdAt
    updatedAt
    relationship user {
      id name
    }
  }
`
```

[Zero](https://zero.rocicorp.dev/docs/reading-data), does it with code that's almost identical to the Supabase example but actually delegates fetching to a sync engine under the hood:

```js
function TodoList() {
  const z = useZero<Schema, Mutators>()

  let todoQuery = z.query.todo
    .related('user')
    .limit(100)

  const [todos, todosDetail] = useQuery(todoQuery)
```

Local-first systems use a local store like [Valtio](https://valtio.dev) or an embedded database like [PGlite](https://pglite.dev), with a sync engine like [Electric](/) to keep the data in sync:

```js
const shape = await pg.electric.syncShapeToTable({
  shape: {
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'todo'
    }
  },
  table: 'todo',
  primaryKey: ['id']
})
```

Your components can then just declare what data they need and interface directly with the local store. For example with PGlite, you can use declarative [live queries](https://pglite.dev/docs/framework-hooks/react#uselivequery):

```js
function TodoList() {
  const todos = useLiveQuery(`SELECT * FROM todos;`, [])
}
```

This still works perfectly with a platform like [Supabase](/docs/integrations/supabase) or [Neon](/docs/integrations/neon) powering the actual database hosting in the cloud. However, the network requests, the actual data fetching are managed by the sync engine behind the scenes. The LLM doesn't need to know how &mdash; and it certainly doesn't need to be writing code that fires off fetch requests at all angles and stages of your rendering pipeline.

This has always been the [endgame for state transfer](/blog/2022/12/16/evolution-state-transfer) and the [next evolution of cloud programming](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper16.pdf). But it's even more important now LLMs are writing the code.

Tell your LLM to stop writing code that does imperative data fetching. Start using declarative data bindings with a sync engine like [Electric](/) instead.