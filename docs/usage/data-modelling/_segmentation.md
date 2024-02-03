---
title: Segmentation
sidebar_position: 50
---

ElectricSQL's shape based sync works by segmenting data into shapes that you can sync onto local-devices.

Data can automatically be segmented by primary keys, foreign keys and a set of basic operator matches. To segment on other aspects, including arbitrary SQL queries, you define segmentation indexes. ElectricSQL provides a number of pre-defined segmentation indexes for common cases. And an extensible mechanism for defining your own, arbitrary, segmentation logic.

## Concept of segmentation

ElectricSQL is designed to support applications that sync data between a central cloud database in Postgres and embedded local databases using SQLite. Sync is managed using [Shapes](../data-access/shapes.md). Shapes define a **query** that filters the rows in a table against a **segmentation index**.

Shape queries **do not** support arbitrary where clauses. They only support clauses that map to segmentation indexes.

Most applications support some kind of natural segmentation, for example:

- by **membership**, such as of an organisation, workspace or group
- by **location**, such as regions, cities or geo-bounding boxes
- by **time window**, such as days, weeks or months

ElectricSQL really shines when you can map your application to a natural segmentation model. For example, a project management app like <DocPageLink path="examples/linear-lite" /> segments well by membership, a delivery app like <DocPageLink path="examples/yum-dash" /> segments well by location.

If you can't naturally segment your data then you may find it difficult to optimise the way data syncs onto the local device. You can filter information on a more granular, row-by-row basis using [Permissions](./permissions.md) but without clean boundaries it's sometimes harder to make the ElectricSQL paradigm work efficiently.


## Primary and foreign keys

You can implicitly segment on **primary keys** and **foreign keys**. For example, in your shape query you can use clauses like the following without having to create any segmentation indexes in your DDLX:

```tsx
{
  where: {
    id: "abcd"
  }
}
```

Or:

```tsx
{
  where: {
    user_id: "abcd"
  }
}
```

See the <DocPageLink path="api/clients/typescript" /> docs for more details on operator support.

:::info
This implicit primary and foreign key segmentation index is also used to support the shape **include tree** and for traversal to lookup **permissions** from **scopes**.
:::

## Pre-defined segmentation indexes

You can create pre-defined segmentation indexes using the [`segment`](../../api/ddlx.md#segment) DDLX function with the `type` parameter.

### Direct column value

```sql
SELECT electric.segment(
  'projects',
  on => 'name'
  type => 'value'
)
```

### Full-text search

```sql
SELECT electric.segment(
  'projects',
  on => 'text',
  type => 'fts'
)
```

Targeted in the shape query using the `search` operator:

```tsx
{
  where: {
    text: {
      search: 'cat & dog'
    }
  }
}
```

### Geo bounding box

```sql
SELECT electric.segment(
  'projects',
  on => 'location'
  type => 'geo.bbox',
  grid_size => '1km'
)
```

Targeted in the shape query using the `within` operator:

```tsx
{
  where: {
    location: {
      within: {
        distance: '5km',
        point: (lat, lng)
      }
    }
  }
}
```

## User-defined segmentation indexes

If the built-in and pre-defined segmentation indexes are not sufficient, you can define arbitrary segmentation logic using user-defined functions. These are passed by name to the [`segment`](../../api/ddlx.md#segment) function using the `get_values_from_row` and `get_segmentation_query` parameters:

```sql
SELECT electric.segment(
  'projects',
  on => 'name',
  type => 'user-defined',
  get_values_from_row => 'my_udf_to_get_values',
  get_clauses_from_query => 'my_udf_to_get_query_clauses'
)
```

The `on` parameter is an abitrary string identifier for the segmentation index, like a virtual column name, that is then used to target the index in the shape query. The `get_values_from_row` function converts the row into a set of values that can be matched on. The `get_clauses_from_query` function converts an arbitrary data structure passed in the shape query into simple where clauses.

### Get values from row

The `get_values_from_row` function will be called with two arguments: the `row` and the `auth` context. It must return a list of simple values. For example:

```sql
CREATE FUNCTION my_udf_to_get_values(row record, auth auth_ctx) RETURNS SETOF text AS $$
  SELECT row.name;
$$ LANGUAGE SQL;
```

### Get clauses from query

The `get_clauses_from_query` function is optional. If it is not provided, the default implementation just passes through the clauses from the shape query.

If provided, it will be called with two arguments: the query `params` in the shape query and the `auth` context. It must return a set of query clauses that can be interpreted using the [standard operators](#operator-support).

For example, given a query like this:

```tsx
{
  where: {
    name: {
      foo: 'bar'
    }
  }
}
```

The following function:

```sql
CREATE FUNCTION my_udf_to_get_query_clauses(params jsonb, auth auth_ctx) RETURNS SETOF query_clause AS $$
  SELECT ROW('name', 'equals', params.name.foo);
$$ LANGUAGE SQL;
```

Effectively converts the query into the equivalent of:

```tsx
{
  where: {
    name: 'bar'
  }
}
```

The segmentation index has been defined on `name`, so the query params are `{foo: 'bar'}`. These are passed through to the function as a jsonb value (an arbitrary json object). Because `foo` is not a standard operator or syntax we support, the function must convert the params to a set of `query_clause`s, a composite type defined as follows:

```sql
CREATE TYPE query_clause AS (
  key text,
  operator text,
  value anyelement
);
```

See <DocPageLink path="api/ddlx" /> for more details.
