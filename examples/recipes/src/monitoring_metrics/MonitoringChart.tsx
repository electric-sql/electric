import { useState } from 'react'
import { MonitoringChartView } from './MonitoringChartView'
import { useMonitoringMetric } from './use_monitoring_metrics'

export const MonitoringChart = () => {
  // The size of the time window to show data for
  const [viewWindowSeconds, setViewWindowSeconds] = useState(60)

  // The size of the "buckets" for which the data will be aggregated
  const [aggregationWindowSeconds, setAggregationWindowSeconds] = useState(5)

  const { timeSeries } = useMonitoringMetric({
    metricType: 'CPU',
    viewWindowSeconds,
    aggregationWindowSeconds,
  })

  return (
    <MonitoringChartView
      dataset={timeSeries}
      dataKeyConfig={{
        avg: { label: 'Average' },
        min: { label: 'Minimum' },
        max: { label: 'Maximum' },
      }}
      timestampKey="timestamp"
      aggregationWindowSeconds={aggregationWindowSeconds}
      onAggregationWindowSecondsChanged={setAggregationWindowSeconds}
      viewWindowSeconds={viewWindowSeconds}
      onViewWindowSecondsChanged={setViewWindowSeconds}
    />
  )
}
