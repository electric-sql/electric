import { useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const useMonitoringMetric = ({
  metricType,
  viewWindowSeconds = 60,
  aggregationWindowSeconds = 5,
} : {
  metricType: 'CPU' | 'Memory' | 'Disk'
  viewWindowSeconds?: number
  aggregationWindowSeconds?: number
}) => {
  // oldest time to select data from in UNIX ms time
  const [oldestTimeToSelect, setOldestTimeToSelect] = useState(0)

  const { db } = useElectric()!

  // perform an aggregation on the timestamps by dividing the Unix Epoch
  // format by [aggregationWindowSeconds] and grouping by that amount, and
  // only show data older than [oldestTimeToSelect]
  const { results: timeSeries = [] } = useLiveQuery<
    {
      timestamp: string
      value_avg: number
      value_max: number
      value_min: number
    }[]
  >(
    db.liveRawQuery({
      sql: `
    SELECT
      timestamp,
      AVG(value) as value_avg,
      MAX(value) as value_max,
      MIN(value) as value_min
    FROM monitoring
    WHERE CAST (strftime('%s', timestamp) AS INT) > ${oldestTimeToSelect}
    AND type = '${metricType}'
    GROUP BY strftime('%s', timestamp) / ${aggregationWindowSeconds}
    ORDER BY timestamp ASC
    `,
    }),
  )

  // update oldest time to show every second or so, or when the
  // view window changes
  useEffect(() => {
    // use a buffer of at least 10sec in front of the data being selected
    // to avoid the time range changing too often
    const viewBufferSeconds = Math.max(viewWindowSeconds * 0.1, 10)
    const updateOldestTimeToShow = () => {
      const steppedTimeSeconds =
        Math.floor(Date.now() / 1000 / viewBufferSeconds) * viewBufferSeconds
      const bufferedStartTimeSeconds = steppedTimeSeconds - viewWindowSeconds
      setOldestTimeToSelect(bufferedStartTimeSeconds)
    }

    updateOldestTimeToShow()
    const interval = setInterval(updateOldestTimeToShow, 1000)
    return () => clearInterval(interval)
  }, [viewWindowSeconds])

  return {
    timeSeries: timeSeries.map((ts) => ({
      timestamp: new Date(ts.timestamp),
      max: ts.value_max,
      min: ts.value_min,
      avg: ts.value_avg,
    }))
  }
}