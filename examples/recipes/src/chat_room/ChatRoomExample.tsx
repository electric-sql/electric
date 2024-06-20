import { Box, Container } from '@mui/material'
import { NavigationBar } from '../components/NavigationBar'
import { useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { ConnectivityToggle } from '../components/ConnectivityToggle'
import { ChatRoom } from './ChatRoom'
import { generateAndPersistRandomName } from './utilities'
import { LoadingView } from '../components/LoadingView'

export const ChatRoomExample = () => {
  const [username] = useState(generateAndPersistRandomName())
  const [synced, setSynced] = useState(false)
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.chat_room.sync()

      // Resolves when the initial data for the shape
      // has been synced into the local database.
      await shape.synced
      setSynced(true)
    }

    syncItems()
  }, [db.chat_room])

  return (
    <Box>
      <NavigationBar title="Chat Room" items={[<ConnectivityToggle key="connectivity" />]} />
      <LoadingView loading={!synced}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <ChatRoom username={username} />
        </Container>
      </LoadingView>
    </Box>
  )
}
