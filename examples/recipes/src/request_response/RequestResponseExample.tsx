import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { RequestResponse } from "./RequestResponse"
import { ConnectivityToggle } from "../components/ConnectivityToggle"
import { LoadingView } from "../components/LoadingView"

export const RequestResponseExample = () => {
  const [ synced, setSynced ] = useState(false)
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
      setSynced(true)
    }

    syncItems()
  }, [db])

  return (
    <Box>
      <NavigationBar title="Request/Response Pattern" items={[
        <ConnectivityToggle key="connectivity" />
      ]}/>
      <LoadingView loading={!synced}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <RequestResponse />
        </Container>
      </LoadingView>
    </Box>
  )
}