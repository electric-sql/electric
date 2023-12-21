import { Paper } from "@mui/material"
import { LineChart } from "@mui/x-charts"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react";
import { useEffect, useState } from "react";



export const MonitoringChart = () => {
  const { db } = useElectric()!;

  const [timeRange, setTimeRange ] = useState([new Date(Date.now() - 10 * 1000), new Date()])


  const { results: timeSeries = [] } = useLiveQuery(db.monitoring.liveMany({
    select: {
      type: true,
      timestamp: true,
      value: true,
    },
    where: {
      timestamp: {
        gte: timeRange[0],
      }
    },
    orderBy: {
      timestamp: 'asc',
    }
  }))


  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRange([
        new Date(Date.now() - 10 * 1000),
        new Date()
      ])

    }, 2000)
    return () => {
      clearInterval(interval)
    }
  }, []);

  

  return (
    <Paper>
      <LineChart
      
        xAxis={[
          {
            data: timeSeries.map((ts) => ts.timestamp),
            scaleType: 'time'
          },
        ]}
        yAxis={[{
          min: 25,
          max: 75
        }]}
        series={[
          {
            data: timeSeries.map((ts) => ts.value),
            curve: "linear",
            showMark: false,
          },
        ]}
        width={500}
        height={300}
        >

      </LineChart>
    </Paper>
  )
}