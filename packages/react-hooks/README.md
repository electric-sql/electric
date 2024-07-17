# React integration for ElectricSQL

Electric is Postgres sync for modern apps.

Electric provides an HTTP interface to Postgres to enable massive number of clients to query and get real-time updates to data in "shapes" i.e. subsets of the database. Electric turns Postgres into a real-time database.

This packages exposes a `useShape` hook for pulling shape data into your React components.

## Install

`npm i @electricsql/react`

## How to use

Add the Shapes provider
```tsx
import { ShapesProvider } from "@electric-sql/react"

ReactDOM.createRoot(document.getElementById(`root`)!).render(
  <ShapesProvider>
    <App />
  </ShapesProvider>
)
```

Add `useShape` to a component
```
import { useShape } from "@electric-sql/react"

export default function MyComponent () {
  const { isUpToDate, data as fooData } = useShape({
    shape: { table: `foo` },
    baseUrl: "http://my-api.com/",
  })

  if (!isUpToDate) {
    return <div>loading</div>
  }
  
  return (
    <div>
      {data.map(foo => <div>{foo.title}</div>)}
    </div>
  )
}
```
