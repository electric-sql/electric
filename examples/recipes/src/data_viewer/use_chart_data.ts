import { useMemo } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const useChartData = ({
  propertyToChart,
  whereClause = '1=1',
  maxDistinctPropertyValues = 10,
  missingPropertyLabel = 'N/A',
}: {
  propertyToChart: string
  whereClause?: string
  maxDistinctPropertyValues?: number
  missingPropertyLabel?: string
}) => {
  const { db } = useElectric()!

  // Find the top values for the given property and filters
  // and select the top `maxDistinctPropertyValues` to display
  const { results: topValues = [] } = useLiveQuery<
    {
      property: unknown
      value: number
    }[]
  >(
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

  // Get the aggregated number of orders, grouped by
  // the given property, for the top property values
  const { results: aggregatedValues = [] } = useLiveQuery<
    {
      month: string
      property: unknown
      value: number
    }[]
  >(
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

  // Convert results to appropriate format to show on the chart
  const dataset = useMemo(
    () =>
      Object.values(
        aggregatedValues.reduce<Record<string, Record<string, number>>>(
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
          {},
        ),
      ),
    [aggregatedValues, propertyLabels, missingPropertyLabel],
  )

  return {
    dataset,
    propertyLabels,
  }
}
