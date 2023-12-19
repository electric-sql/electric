import { Box, Container, Switch } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { Calculator } from "./Calculator"
import { useConnectivityState } from "electric-sql/react"
import { Wifi, WifiOff } from "@mui/icons-material"

export const RequestResponseExample = () => {
  const { db } = useElectric()!
  const { connectivityState, toggleConnectivityState } = useConnectivityState();
  const connected = connectivityState == 'connected';

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
        <Box key="connectivity" sx={{ display: 'flex', alignItems: 'center' }}>
          <Switch color="secondary" size="small" sx={{ mr: 1 }}
            checked={connected} onChange={toggleConnectivityState} />
          { connected ? <Wifi />  : <WifiOff /> }
        </Box>
      ]}/>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Calculator />
      </Container>
    </Box>
  )
}