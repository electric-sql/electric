import { Box, MenuItem, Paper, Select, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material"
import { LineChart, LineSeriesType } from "@mui/x-charts"
import { useElectric } from "../electric/ElectricWrapper"
import { useState } from "react";
import { useLiveQuery } from "electric-sql/react";


export const MonitoringChart = () => {
  const [ viewWindowSeconds, setViewWindowSeconds ] = useState(60)
  const [ aggregationWindowSeconds, setAggregationWindowSeconds ] = useState(20)
  const { db } = useElectric()!;

  const viewBufferSeconds = Math.max((viewWindowSeconds * 0.10), 10)
  const startTimeSeconds =
    Math.round((Date.now() / 1000) / viewBufferSeconds) * viewBufferSeconds - 
    viewWindowSeconds
  
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
    WHERE CAST (strftime('%s', timestamp) AS INT) > ${startTimeSeconds}
    GROUP BY strftime('%s', timestamp) / ${aggregationWindowSeconds}
    ORDER BY timestamp ASC
    `
  }))

  return (
    <Paper sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2 }}>
      <MonitoringChartControlView
        aggregationWindowSeconds={aggregationWindowSeconds}
        onAggregationWindowSecondsChanged={setAggregationWindowSeconds}
        viewWindowSeconds={viewWindowSeconds}
        onViewWindowSecondsChanged={setViewWindowSeconds}
      />
      <MonitoringLineChartView
        dataset={timeSeries.map((ts) => ({ ...ts, timestamp: new Date(ts.timestamp)}))}
        dataKeyConfig={{
          'value_avg': { label: 'Average' },
          'value_min': { label: 'Minimum' },
          'value_max': { label: 'Maximum' }
        }}
        timestampKey="timestamp"
      />
    </Paper>
  )
}

const MonitoringLineChartView = ({
  dataset = [],
  dataKeyConfig = {},
  timestampKey = 'timestamp',
} : {
  dataset: Record<string, number | Date>[],
  dataKeyConfig: Record<string, Omit<LineSeriesType, 'type'>>,
  timestampKey?: string,
}) => {
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
          tickNumber: 10,
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
              minimumSignificantDigits: 3,
              maximumSignificantDigits: 3
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


const MonitoringChartControlView = ({
  aggregationWindowSeconds,
  onAggregationWindowSecondsChanged,
  viewWindowSeconds,
  onViewWindowSecondsChanged,
} : {
  aggregationWindowSeconds: number,
  onAggregationWindowSecondsChanged: (val: number) => void,
  viewWindowSeconds: number,
  onViewWindowSecondsChanged: (val: number) => void,

}) => {
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
          <ToggleButton value={30}>30 sec</ToggleButton>
          <ToggleButton value={60}>1 min</ToggleButton>
          <ToggleButton value={5 * 60}>5 min</ToggleButton>
          <ToggleButton value={10 * 60}>10 min</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Box>
  )
}