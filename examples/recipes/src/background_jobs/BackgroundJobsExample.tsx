import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { BackgroundJobs } from "./BackgroundJobs"
import { ConnectivityToggle } from "../components/ConnectivityToggle"

export const BackgroundJobsExample = () => {
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.background_jobs.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [db.background_jobs])


  return (
    <Box>
      <NavigationBar title="Background Jobs" items={[
        <ConnectivityToggle key="connectivity" />
      ]}/>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <BackgroundJobs />
      </Container>
    </Box>
  )
}