import { Box, MenuItem, Paper, Select, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material"
import { LineChart, LineSeriesType } from "@mui/x-charts"
import { useElectric } from "../electric/ElectricWrapper"
import { useEffect, useState } from "react";
import { useLiveQuery } from "electric-sql/react";


export const MonitoringChart = () => {
  // Oldest time to show data for in Unix time
  const [ oldestTimeToShowSeconds, setOldestTimeToShowSeconds ] = useState(0)

  // The size of the time window to show data for
  const [ viewWindowSeconds, setViewWindowSeconds ] = useState(60)

  // The size of the "buckets" for which the data will be aggregated
  const [ aggregationWindowSeconds, setAggregationWindowSeconds ] = useState(5)

  const { db } = useElectric()!;

  // perform an aggregation on the timestamps by dividing the Unix Epoch
  // format by [aggregationWindowSeconds] and grouping by that amount, and
  // only show data older than [oldestTimeToShowSeconds]
  const { results: timeSeries = [] } =  useLiveQuery<{
    timestamp: string,
    value_avg: number,
    value_max: number,
    value_min: number
  }[]>(db.liveRaw({
    sql:`
    SELECT
      timestamp,
      AVG(value) as value_avg,
      MAX(value) as value_max,
      MIN(value) as value_min
    FROM monitoring
    WHERE CAST (strftime('%s', timestamp) AS INT) > ${oldestTimeToShowSeconds}
    GROUP BY strftime('%s', timestamp) / ${aggregationWindowSeconds}
    ORDER BY timestamp ASC
    `
  }))

  
  // update oldest time to show every second or so, or when the
  // view window changes
  useEffect(() => {
    // use a buffer of at least 10sec in front of the data being shown
    // to avoid the time range changing too often
    const viewBufferSeconds = Math.max((viewWindowSeconds * 0.10), 10)

    const updateOldestTimeToShow = () => {
      const steppedTimeSeconds =
        Math.floor((Date.now() / 1000) / viewBufferSeconds) * viewBufferSeconds
      const bufferedStartTimeSeconds = steppedTimeSeconds - viewWindowSeconds
      setOldestTimeToShowSeconds(bufferedStartTimeSeconds)
    }

    updateOldestTimeToShow()
    const interval = setInterval(updateOldestTimeToShow, 1000)
    return () => clearInterval(interval)
  }, [viewWindowSeconds])


  return (
    <MonitoringChartView
      dataset={timeSeries.map((ts) => ({ ...ts, timestamp: new Date(ts.timestamp)}))}
      dataKeyConfig={{
        'value_avg': { label: 'Average' },
        'value_min': { label: 'Minimum' },
        'value_max': { label: 'Maximum' }
      }}
      timestampKey="timestamp"
      aggregationWindowSeconds={aggregationWindowSeconds}
      onAggregationWindowSecondsChanged={setAggregationWindowSeconds}
      viewWindowSeconds={viewWindowSeconds}
      onViewWindowSecondsChanged={setViewWindowSeconds}
    />
  )
}

interface MonitoringChartViewProps extends
  MonitoringLineChartViewProps,
  MonitoringChartControlViewProps {}

const MonitoringChartView = ({
  dataset,
  dataKeyConfig,
  timestampKey = 'timestamp',
  aggregationWindowSeconds,
  onAggregationWindowSecondsChanged,
  viewWindowSeconds,
  onViewWindowSecondsChanged,
}: MonitoringChartViewProps) => {
  return (
    <Paper sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2 }}>
      <MonitoringChartControlView
        aggregationWindowSeconds={aggregationWindowSeconds}
        onAggregationWindowSecondsChanged={onAggregationWindowSecondsChanged}
        viewWindowSeconds={viewWindowSeconds}
        onViewWindowSecondsChanged={onViewWindowSecondsChanged}
      />
      <MonitoringLineChartView
        dataset={dataset}
        dataKeyConfig={dataKeyConfig}
        timestampKey={timestampKey}
      />
    </Paper>
  )
}

interface MonitoringLineChartViewProps {
  dataset: Record<string, number | Date>[],
  dataKeyConfig: Record<string, Omit<LineSeriesType, 'type'>>,
  timestampKey?: string
}

const MonitoringLineChartView = ({
  dataset = [],
  dataKeyConfig = {},
  timestampKey = 'timestamp',
} : MonitoringLineChartViewProps) => {
  return (
    <LineChart
      height={400}
      margin={{ bottom: 100 }}
      slotProps={{
        legend: {
          position: {
            vertical: 'bottom',
            horizontal: 'middle',
          }
        }
      }}
      xAxis={[
        {
          dataKey: timestampKey,
          scaleType: 'time',
          tickMinStep: 10 * 1000,
          tickNumber: 8,
          label: 'Time',
        },
      ]}
      yAxis={[{
        label: 'CPU Usage (%)'
      }]}
      dataset={dataset}
      series={Object.keys(dataKeyConfig).map((dataKey) => (
        {
          dataKey: dataKey,
          label: dataKeyConfig[dataKey].label,
          showMark: false,
          valueFormatter: (v) => `${v?.toLocaleString(
            'en-US', 
            {
              minimumSignificantDigits: 2,
              maximumSignificantDigits: 2
            }
          )}%`,
          curve: 'stepBefore',
          stackStrategy: {
            stack: 'total',
            area: false,
            stackOffset: 'none',
          }
        }
      ))}
      tooltip={{ trigger: 'axis' }}
    />
  )
}

interface MonitoringChartControlViewProps {
  aggregationWindowSeconds: number,
  onAggregationWindowSecondsChanged: (val: number) => void,
  viewWindowSeconds: number,
  onViewWindowSecondsChanged: (val: number) => void
}

const MonitoringChartControlView = ({
  aggregationWindowSeconds,
  onAggregationWindowSecondsChanged,
  viewWindowSeconds,
  onViewWindowSecondsChanged,
} : MonitoringChartControlViewProps) => {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'row',
      alignItems: 'center', justifyContent: 'space-between',
      width: '100%'
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ mr: 1 }}>
          Aggregation Period:
        </Typography>
        <Select
          value={aggregationWindowSeconds}
          size="small"
          onChange={(e) => onAggregationWindowSecondsChanged(e.target.value as number)}
        >
          <MenuItem value={1}>1 sec</MenuItem>
          <MenuItem value={5}>5 sec</MenuItem>
          <MenuItem value={20}>20 sec</MenuItem>
          <MenuItem value={60}>60 sec</MenuItem>
          <MenuItem value={90}>90 sec</MenuItem>
        </Select>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ mr: 1 }}>
          View Window:
        </Typography>
        <ToggleButtonGroup
          value={viewWindowSeconds}
          exclusive
          size="small"
          onChange={(_, newVal) => newVal != null ?
            onViewWindowSecondsChanged(newVal) :
            null
          }
        >
          <ToggleButton value={1 * 60}>1 min</ToggleButton>
          <ToggleButton value={5 * 60}>5 min</ToggleButton>
          <ToggleButton value={10 * 60}>10 min</ToggleButton>
          <ToggleButton value={30 * 60}>30 min</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Box>
  )
}