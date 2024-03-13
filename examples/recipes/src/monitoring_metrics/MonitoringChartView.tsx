import {
  Box,
  MenuItem,
  Paper,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { LineChart, LineSeriesType } from '@mui/x-charts'

interface MonitoringChartViewProps
  extends MonitoringLineChartViewProps,
    MonitoringChartControlViewProps {}

export const MonitoringChartView = ({
  dataset,
  dataKeyConfig,
  timestampKey = 'timestamp',
  aggregationWindowSeconds,
  onAggregationWindowSecondsChanged,
  viewWindowSeconds,
  onViewWindowSecondsChanged,
}: MonitoringChartViewProps) => {
  return (
    <Paper
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        p: 2,
      }}>
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
  dataset: Record<string, number | Date>[]
  dataKeyConfig: Record<string, Omit<LineSeriesType, 'type'>>
  timestampKey?: string
}

const MonitoringLineChartView = ({
  dataset = [],
  dataKeyConfig = {},
  timestampKey = 'timestamp',
}: MonitoringLineChartViewProps) => {
  return (
    <LineChart
      height={400}
      margin={{ bottom: 100 }}
      slotProps={{
        legend: {
          position: {
            vertical: 'bottom',
            horizontal: 'middle',
          },
        },
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
      yAxis={[
        {
          label: 'CPU Usage (%)',
        },
      ]}
      dataset={dataset}
      series={Object.keys(dataKeyConfig).map((dataKey) => ({
        dataKey: dataKey,
        label: dataKeyConfig[dataKey].label,
        showMark: false,
        valueFormatter: (v) =>
          `${v?.toLocaleString('en-US', {
            minimumSignificantDigits: 2,
            maximumSignificantDigits: 2,
          })}%`,
        curve: 'stepBefore',
        stackStrategy: {
          stack: 'total',
          area: false,
          stackOffset: 'none',
        },
      }))}
      tooltip={{ trigger: 'axis' }}
    />
  )
}

interface MonitoringChartControlViewProps {
  aggregationWindowSeconds: number
  onAggregationWindowSecondsChanged: (val: number) => void
  viewWindowSeconds: number
  onViewWindowSecondsChanged: (val: number) => void
}

const MonitoringChartControlView = ({
  aggregationWindowSeconds,
  onAggregationWindowSecondsChanged,
  viewWindowSeconds,
  onViewWindowSecondsChanged,
}: MonitoringChartControlViewProps) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ mr: 1 }}>Aggregation Period:</Typography>
        <Select
          value={aggregationWindowSeconds}
          size="small"
          onChange={(e) => onAggregationWindowSecondsChanged(e.target.value as number)}>
          <MenuItem value={1}>1 sec</MenuItem>
          <MenuItem value={5}>5 sec</MenuItem>
          <MenuItem value={20}>20 sec</MenuItem>
          <MenuItem value={60}>60 sec</MenuItem>
          <MenuItem value={90}>90 sec</MenuItem>
        </Select>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ mr: 1 }}>View Window:</Typography>
        <ToggleButtonGroup
          value={viewWindowSeconds}
          exclusive
          size="small"
          onChange={(_, newVal) => (newVal != null ? onViewWindowSecondsChanged(newVal) : null)}>
          <ToggleButton value={1 * 60}>1 min</ToggleButton>
          <ToggleButton value={5 * 60}>5 min</ToggleButton>
          <ToggleButton value={10 * 60}>10 min</ToggleButton>
          <ToggleButton value={30 * 60}>30 min</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Box>
  )
}
