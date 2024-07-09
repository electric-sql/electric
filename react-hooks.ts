import { useState, useEffect } from 'react'
import {
  BackoffDefaults,
  Shape,
  ShapeStream,
  ShapeStreamOptions,
} from './client'

export function useShape(options: ShapeStreamOptions) {
  const [shapeData, setShapeData] = useState<unknown[]>([])

  useEffect(() => {
    const shape = new Shape(
      options.shape,
      { baseUrl: options.baseUrl },
      BackoffDefaults
    )
    const cancelSubs = shape.subscribe((map) => {
      setShapeData([...map.values()])
    })

    shape.sync()

    return cancelSubs
  }, [])

  return shapeData
}
