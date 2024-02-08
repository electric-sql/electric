/* eslint-disable react-hooks/exhaustive-deps */
import { Box, Button, Container } from '@mui/material'
import { NavigationBar } from '../components/NavigationBar'
import { useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { generateActivity } from './utilities'
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

      // Resolves when the data has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [])

  const generateUserActivity = () => {
    db.activity_events.create({
      data: generateActivity(),
    })
  }

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
          <Button variant="contained" size="large" onClick={generateUserActivity}>
            Generate activity
          </Button>
          <ActivityToast />
        </Container>
      </LoadingView>
    </Box>
  )
}
