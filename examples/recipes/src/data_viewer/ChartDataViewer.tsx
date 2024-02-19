import { useState } from 'react'
import { ChartView } from './components/ChartView'
import { Selector } from './components/Selector'
import { useChartData } from './use_chart_data'

export const ChartDataViewer = ({
  whereClause,
  aggregateColumns,
}: {
  whereClause: string
  aggregateColumns: { field: string; headerName: string }[]
}) => {
  // Specify how many values to show
  const [numValuesToShow] = useState(5)

  // The property by which results will be grouped and aggregated
  const [groupProperty, setGroupProperty] = useState(aggregateColumns[0].field)

  const { dataset, propertyLabels } = useChartData({
    propertyToChart: groupProperty,
    aggregationWindowSeconds: 30 * 24 * 60 * 60, // aggregate by month
    whereClause,
    maxDistinctPropertyValues: numValuesToShow,
  })

  return (
    <div style={{ position: 'relative' }}>
      <Selector
        style={{ position: 'absolute', right: 0, zIndex: 1 }}
        selectedValue={groupProperty}
        values={aggregateColumns.map((c) => c.field)}
        valueLabels={aggregateColumns.map((c) => c.headerName)}
        label="Aggregate By"
        onValueSelected={setGroupProperty}
      />
      <ChartView
        xAxis={{
          dataKey: 'month',
          scaleType: 'time',
          label: 'Month',
        }}
        yAxis={{
          label: 'Number of Orders',
          tickMinStep: 1,
        }}
        keysToShow={propertyLabels}
        dataset={dataset}
        height={400}
      />
    </div>
  )
}
