import React, { useEffect, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'

export default function ShapesTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [shapes, setShapes] = useState<string[]>(
    api.getSatelliteShapeSubscriptions(dbName),
  )

  useEffect(() => {
    // periodically refresh shape subscriptions
    const interval = setInterval(
      () => setShapes(api.getSatelliteShapeSubscriptions(dbName)),
      1000,
    )
    return () => clearInterval(interval)
  }, [dbName, api])

  return (
    <div>
      <h4>Fulfilled shapes</h4>
      <ul>
        {shapes.map((shape) => (
          <li>{shape}</li>
        ))}
      </ul>
    </div>
  )
}
