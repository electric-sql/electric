import { AxisConfig, LineChart } from '@mui/x-charts'

export const ChartView = ({
  dataset,
  keysToShow,
  xAxis,
  yAxis,
  height,
  width,
}: {
  dataset: Record<string, any>[]
  keysToShow: string[]
  xAxis: Partial<AxisConfig>
  yAxis?: Partial<AxisConfig>
  height?: number
  width?: number
}) => {
  return (
    <LineChart
      series={keysToShow.map((key) => ({
        dataKey: key,
        label: key,
        curve: 'linear',
        showMark: false,
      }))}
      xAxis={[xAxis]}
      yAxis={!yAxis ? undefined : [yAxis]}
      dataset={dataset}
      slotProps={{ legend: { hidden: true } }}
      height={height}
      width={width}
    />
  )
}
