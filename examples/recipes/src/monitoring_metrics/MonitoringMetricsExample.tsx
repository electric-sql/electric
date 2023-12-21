import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { MonitoringChart } from "./MonitoringChart"

export const MonitoringMetricsExample = () => {
  const { db } = useElectric()!

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.monitoring.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [db])

  return (
    <Box>
      <NavigationBar title="Monitoring Metrics" />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <MonitoringChart />
      </Container>
    </Box>
  )
}