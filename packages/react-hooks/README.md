# React integration for ElectricSQL

Electric is Postgres sync for modern apps.

Electric provides an HTTP interface to Postgres to enable massive number of clients to query and get real-time updates to data in "shapes" i.e. subsets of the database. Electric turns Postgres into a real-time database.

This packages exposes a `useShape` hook for pulling shape data into your React components.

`Shapes` and `ShapeStreams` instances are cached globally so re-using shapes in multiple components is cheap.

## Install

`npm i @electricsql/react`

## How to use

Add `useShape` to a component

```tsx
import { useShape } from "@electric-sql/react"

export default function MyComponent () {
  const { isLoading, data } = useShape({
    url: "http://my-api.com/shape/foo",
  })

  if (isLoading) {
    return <div>loading</div>
  }

  return (
    <div>
      {data.map(foo => <div>{foo.title}</div>)}
    </div>
  )
}
```
