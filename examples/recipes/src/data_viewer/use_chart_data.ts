import { useLiveQuery } from 'electric-sql/react'
import { useElectric } from '../electric/ElectricWrapper'
import { useMemo } from 'react'

type Chartable = string | number | boolean
interface PropertyValue<T extends Chartable> {
  property: T
  value: number
}

interface MonthlyPropertyValue<T extends Chartable> extends PropertyValue<T> {
  month: string
}

export const useChartData = <T extends Chartable>({
  propertyToChart,
  whereClause = '1=1',
  maxDistinctPropertyValues = 10,
  missingPropertyLabel = 'N/A',
}: {
  propertyToChart: T
  whereClause?: string
  maxDistinctPropertyValues?: number
  missingPropertyLabel?: string
}) => {
  const { db } = useElectric()!

  // Find the top values for the given query and select a few to display
  const { results: topValues = [] } = useLiveQuery<PropertyValue<T>[]>(
    db.liveRawQuery({
      sql: `
      SELECT ${propertyToChart} as property, COUNT(${propertyToChart}) as value
      FROM commerce_orders
      WHERE ${whereClause}
      GROUP BY property
      ORDER BY value DESC
      LIMIT ${maxDistinctPropertyValues}
    `,
    }),
  )

  const propertyLabels = useMemo(
    () => topValues.map((r) => r.property?.toString() ?? missingPropertyLabel),
    [topValues, missingPropertyLabel],
  )

  // Get the aggregated number of orders, grouped by the given property, for the top keys
  const { results: aggregatedValues = [] } = useLiveQuery<MonthlyPropertyValue<T>[]>(
    db.liveRawQuery({
      sql: `
      SELECT
        strftime('%Y-%m', timestamp) AS month,
        ${propertyToChart} as property,
        COUNT(${propertyToChart}) as value
      FROM commerce_orders
      WHERE ${whereClause}
      GROUP BY month, property
      ORDER BY month ASC, value DESC
    `,
    }),
  )

  // Convert to appropriate format to show on the chart
  const dataset = useMemo(
    () =>
      Object.values(
        aggregatedValues.reduce(
          (aggregated, row) => ({
            ...aggregated,
            [row.month]: {
              ...(aggregated[row.month] ?? {
                month: new Date(row.month),
                ...propertyLabels.reduce((agg, key) => ({ ...agg, [key]: 0 }), {}),
              }),
              [row.property?.toString() ?? missingPropertyLabel]: row.value,
            },
          }),
          {} as Record<string, Record<string, number>>,
        ),
      ),
    [aggregatedValues, propertyLabels, missingPropertyLabel],
  )

  return {
    dataset,
    propertyLabels,
  }
}
