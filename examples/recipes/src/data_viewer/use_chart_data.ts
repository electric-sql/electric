import { useMemo } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const useChartData = ({
  propertyToChart,
  aggregationWindowSeconds = 30 * 24 * 60 * 60,
  whereClause = '1=1',
  maxDistinctPropertyValues = 10,
  missingPropertyLabel = 'N/A',
}: {
  propertyToChart: string
  aggregationWindowSeconds: number
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
      time_period: string
      property: unknown
      value: number
    }[]
  >(
    db.liveRawQuery({
      sql: `
      SELECT
        (strftime('%s', timestamp) / ${aggregationWindowSeconds}) as time_period,
        ${propertyToChart} as property,
        COUNT(${propertyToChart}) as value
      FROM commerce_orders
      WHERE ${whereClause}
      GROUP BY time_period, property
      ORDER BY time_period ASC, value DESC
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
            [row.time_period]: {
              ...(aggregated[row.time_period] ?? {
                month: new Date(Number(row.time_period) * aggregationWindowSeconds * 1000),
                ...propertyLabels.reduce((agg, key) => ({ ...agg, [key]: 0 }), {}),
              }),
              [row.property?.toString() ?? missingPropertyLabel]: row.value,
            },
          }),
          {},
        ),
      ),
    [aggregatedValues, propertyLabels, missingPropertyLabel, aggregationWindowSeconds],
  )

  return {
    dataset,
    propertyLabels,
  }
}
