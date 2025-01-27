import type {
  Row,
  ShapeStreamOptions,
  GetExtensions,
} from '@electric-sql/client'
import { ShapeStream, Shape } from '@electric-sql/client'

export type HydratedShapeData<SourceData extends Row<unknown> = Row<unknown>> =
  {
    value: Record<string, SourceData>
    options: ShapeStreamOptions<GetExtensions<SourceData>>
  }

export const hydrateShape = <SourceData extends Row<unknown>>(
  shape: Shape<SourceData>
): HydratedShapeData<SourceData> => {
  return {
    value: Object.fromEntries(shape.currentValue),
    options: {
      ...shape.options,
      handle: shape.handle,
      offset: shape.offset,
    },
  }
}

export const dehydrateShape = <SourceData extends Row<unknown>>(
  hydratedShape: HydratedShapeData<SourceData>
): Shape<SourceData> => {
  const stream = new ShapeStream<SourceData>({
    ...hydratedShape.options,
    live: true,
  })
  const shape = new Shape<SourceData>(stream)
  shape.currentValue = new Map(Object.entries(hydratedShape.value))
  return shape
}
