import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { BackgroundJobs } from "./BackgroundJobs"
import { ConnectivityToggle } from "../components/ConnectivityToggle"
import { LoadingView } from "../components/LoadingView"

export const BackgroundJobsExample = () => {
  const [ synced, setSynced ] = useState(false)
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.background_jobs.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [db.background_jobs])


  return (
    <Box>
      <NavigationBar title="Background Jobs" items={[
        <ConnectivityToggle key="connectivity" />
      ]}/>
      <LoadingView loading={!synced}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <BackgroundJobs />
        </Container>
      </LoadingView>
    </Box>
  )
}