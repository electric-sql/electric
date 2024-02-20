import { Box, Paper } from '@mui/material'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { RequestAuditLogView } from './RequestAuditLogView'
import { RequestForm } from './RequestForm'

export const RequestResponse = () => {
  const { db } = useElectric()!

  // TODO(msfstef): better query builder for left joins
  const { results: requests = [] } = useLiveQuery(
    db.liveRawQuery({
      sql: `
    SELECT
        r.timestamp AS requestTime,
        r.path AS path,
        r.method AS method,
        r.data AS payload,
        r.processing AS processing,
        r.cancelled AS cancelled,
        rs.timestamp AS responseTime,
        rs.status_code AS responseStatus,
        rs.data AS responseData
    FROM
        requests r
    LEFT JOIN
        responses rs ON r.id = rs.request_id
    ORDER BY
        r.timestamp DESC
    LIMIT
        10;
    `,
    }),
  )

  return (
    <Box display="flex" flexDirection="column" alignItems="center">
      <Paper sx={{ p: 2, mb: 3, minWidth: 800 }}>
        <RequestForm />
      </Paper>
      <Paper>
        <RequestAuditLogView rows={requests} />
      </Paper>
    </Box>
  )
}
