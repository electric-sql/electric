import { Box, Button, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useEffect } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { genUUID } from "electric-sql/util"
import { LogViewer } from "./LogViewer"

export const LogViewerExample = () => {
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.logs.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [db.logs])

  const generateLog = () => db.logs.create({
    data: {
      id: genUUID(),
      timestamp: new Date(),
      content: 'Test ' + (Math.random() > 0.5 ? 'banana' : 'potato')
    }
  })

  return (
    <Box>
      <NavigationBar title="Log Viewer" />
      <Button onClick={generateLog}>
        generate log
      </Button>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <LogViewer />
      </Container>
    </Box>
  )
}