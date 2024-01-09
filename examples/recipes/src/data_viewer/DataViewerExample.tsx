import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { DataViewer } from "./DataViewer"

export const DataViewerExample = () => {
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.commerce_orders.sync()
      console.log('syncing')

      // Resolves when the data has been synced into the local database.
      await shape.synced
      console.log('synced')
    }

    syncItems()
  }, [db.commerce_orders])


  return (
    <Box>
      <NavigationBar title="Data Viewer" />
      <Container sx={{ py: 4 }}>
        <DataViewer />
      </Container>
    </Box>
  )
}