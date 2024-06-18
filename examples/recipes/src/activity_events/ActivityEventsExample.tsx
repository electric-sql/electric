/* eslint-disable react-hooks/exhaustive-deps */
import { Box, Typography, Container } from '@mui/material'
import { NavigationBar } from '../components/NavigationBar'
import { useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { ActivityToast } from './ActivityToast'
import { ActivityPopover } from './ActivityPopover'
import { LoadingView } from '../components/LoadingView'

export const ActivityEventsExample = () => {
  const [synced, setSynced] = useState(false)
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.activity_events.sync()

      // Resolves when the initial data for the shape
      // has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <NavigationBar title="Activity Events" items={[<ActivityPopover key="notifications" />]} />
      <LoadingView loading={!synced}>
        <Container
          maxWidth="sm"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
          <Typography variant="h5">Activities will be streaming in</Typography>
          <ActivityToast />
        </Container>
      </LoadingView>
    </Box>
  )
}
