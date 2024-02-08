import { Box, Container } from '@mui/material'
import { NavigationBar } from '../components/NavigationBar'
import { useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { LogViewer } from './LogViewer'
import { LoadingView } from '../components/LoadingView'

export const LogViewerExample = () => {
  const [synced, setSynced] = useState(false)
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.logs.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [db.logs])

  return (
    <Box height="100%" display="flex" flexDirection="column">
      <NavigationBar title="Log Viewer" />
      <LoadingView loading={!synced}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <LogViewer />
        </Container>
      </LoadingView>
    </Box>
  )
}
