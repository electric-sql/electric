import { Box, Button, Container } from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { useCallback, useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { genUUID } from "electric-sql/util"
import { LogViewer } from "./LogViewer"
import { generateWebServerLog } from "./utilities"

export const LogViewerExample = () => {
  const [generatingLogs, setGeneratingLogs] = useState(false);
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


  // Generate a random web log with a randomized delay
  const generateRandomLog = useCallback(
    () => setTimeout(() => db.logs.create({
      data: {
        id: genUUID(),
        timestamp: new Date(),
        content: generateWebServerLog(),
      }
    }), Math.random() * 500),
    [db.logs]
  )

  useEffect(() => {
    if (!generatingLogs) return

    const interval = setInterval(generateRandomLog, 100)
    return () => clearInterval(interval)
  }, [generateRandomLog, generatingLogs]);

  return (
    <Box>
      <NavigationBar title="Log Viewer" items={[
        <Button
          variant="contained"
          color="primary"
          key="generate-logs"
          onClick={() => setGeneratingLogs((f) => !f)}>
          {
            generatingLogs ?
              "STOP GENERATING LOGS" :
              "START GENERATING LOGS"
          }
        </Button>
      ]} />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <LogViewer />
      </Container>
    </Box>
  )
}