import { useState, useEffect } from 'react'
import { Shape, ShapeStream, ShapeStreamOptions } from './client'

export function useShape(options: ShapeStreamOptions) {
  const [shapeData, setShapeData] = useState<unknown[]>([])

  useEffect(() => {
    const shape = new Shape(options)
    const unsubscribe = shape.subscribe((map) => {
      setShapeData([...map.values()])
    })

    return () => {
      unsubscribe()
    }
  }, [])

  return shapeData
}
