import { Box, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { ConnectivityToggle } from "../components/ConnectivityToggle"

export const ChatRoomExample = () => {
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.chat_room.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [db.chat_room])


  return (
    <Box>
      <NavigationBar title="Chat Room" items={[
        <ConnectivityToggle key="connectivity" />
      ]}/>
      <Container maxWidth="md" sx={{ py: 4 }}>
        
      </Container>
    </Box>
  )
}