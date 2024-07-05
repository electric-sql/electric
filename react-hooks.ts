import { useState, useEffect } from 'react'
import { Shape, ShapeStream, ShapeStreamOptions } from './client'

export function useShape(options: ShapeStreamOptions) {
  const [shapeData, setShapeData] = useState<unknown[]>([])

  useEffect(() => {
    const shapeStream = new ShapeStream(options)
    const shape = new Shape(shapeStream)
    const subscriptionId = shape.subscribe((map) => {
      setShapeData([...map.values()])
    })

    shape.sync()

    return () => {
      shape.unsubscribe(subscriptionId)
    }
  }, [])

  return shapeData
}
