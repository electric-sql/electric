import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { CommerceAnalytics } from "./CommerceAnalytics"

export const CommerceAnalyticsExample = () => {
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.commerce_orders.sync({
        // include: {
        //   commerce_line_items: true
        // }
      })

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [db.commerce_orders])


  return (
    <Box>
      <NavigationBar title="Analytics" />
      <Container sx={{ py: 4 }}>
        <CommerceAnalytics />
      </Container>
    </Box>
  )
}