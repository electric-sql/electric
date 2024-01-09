import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { MonitoringChart } from "./MonitoringChart"
import { LoadingView } from "../components/LoadingView"

export const MonitoringMetricsExample = () => {
  const [ synced, setSynced ] = useState(false)
  const { db } = useElectric()!

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.monitoring.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [db])

  return (
    <Box>
      <NavigationBar title="Monitoring Metrics" />
      <LoadingView loading={!synced}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <MonitoringChart />
        </Container>
      </LoadingView>
    </Box>
  )
}