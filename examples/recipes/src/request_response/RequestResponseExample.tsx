import { Box, Container, Divider } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { Calculator } from "./Calculator"
import { CalculatorAuditLog } from "./CalculatorAuditLog"
import { ConnectivityToggle } from "../components/ConnectivityToggle"

export const RequestResponseExample = () => {
  const { db } = useElectric()!

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.requests.sync({
        include: {
          responses: true
        }
      })

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [db])

  return (
    <Box>
      <NavigationBar title="Request/Response Pattern" items={[
        <ConnectivityToggle key="connectivity" />
      ]}/>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Calculator />
        <Divider sx={{ my: 2 }} />
        <CalculatorAuditLog />
      </Container>
    </Box>
  )
}