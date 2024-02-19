import { useState } from 'react'
import { ChartView } from './components/ChartView'
import { Selector } from './components/Selector'
import { useChartData } from './use_chart_data'

export const ChartDataViewer = ({
  whereClause,
  aggregateCols,
}: {
  whereClause: string
  aggregateCols: { field: string; headerName: string }[]
}) => {
  // Specify how many values to show
  const [numValuesToShow] = useState(5)

  // The property by which results will be grouped and aggregated
  const [groupProperty, setGroupProperty] = useState(aggregateCols[0].field)

  const { dataset, propertyLabels } = useChartData({
    propertyToChart: groupProperty,
    whereClause,
    maxDistinctPropertyValues: numValuesToShow,
  })

  return (
    <div style={{ position: 'relative' }}>
      <Selector
        style={{ position: 'absolute', right: 0, zIndex: 1 }}
        selectedValue={groupProperty}
        values={aggregateCols.map((c) => c.field)}
        valueLabels={aggregateCols.map((c) => c.headerName)}
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
