import { Box, Paper } from '@mui/material'
import { RequestForm } from './RequestForm'
import { RequestAuditLog } from './RequestAuditLog'

export const RequestResponse = () => {
  return (
    <Box display="flex" flexDirection="column" alignItems="center">
      <Paper sx={{ p: 2, mb: 3, minWidth: 800 }}>
        <RequestForm />
      </Paper>
      <Paper>
        <RequestAuditLog />
      </Paper>
    </Box>
  )
}
