import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { DataViewer } from "./DataViewer"
import { LoadingView } from "../components/LoadingView"

export const DataViewerExample = () => {
  const [ synced, setSynced ] = useState(false)
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.commerce_orders.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [db.commerce_orders])


  return (
    <Box>
      <NavigationBar title="Data Viewer" />
      <LoadingView loading={!synced}>
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <DataViewer />
        </Container>
      </LoadingView>
    </Box>
  )
}