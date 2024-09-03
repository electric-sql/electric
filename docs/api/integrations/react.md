---
outline: deep
---

# React integration

To use Electric with React, we maintain a React provider and hook to simplify reading shape data in components.

Example usage in a component.
```tsx
import { useShape } from "@electric-sql/react"

export default function MyComponent() {
  const { isUpToDate, data } = useShape({
    url: `http://localhost:3000/v1/shape/foo`,
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
Other helpful functions:

- `useShapeContext` — access the Shape Context
- `preloadShape` — useful to call in route loading functions or elsewhere when you want to ensure Shape data is loaded before rendering a route or component.
- `getShapeStream` — get (or create) a ShapeStream off the global cache
- `getShape` — get (or create) a Shape off the global cache

