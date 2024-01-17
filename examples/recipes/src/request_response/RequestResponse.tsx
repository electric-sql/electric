import { useCallback } from "react"
import { HttpMethod } from "./utilities"
import { Box, Paper } from "@mui/material"
import { RequestFormView } from "./RequestFormView"
import { useElectric } from "../electric/ElectricWrapper"
import { genUUID } from "electric-sql/util"
import { useLiveQuery } from "electric-sql/react"
import { RequestAuditLogView } from "./RequestAuditLogView"



const paths = [
  '/health',
  '/user/activities',
]

export const RequestResponse = () => {
  const { db } = useElectric()!

  const sendRequest = useCallback((
    method: HttpMethod,
    path: string,
    payload: string | null
  ) => db.requests.create({
    data: {
      id: genUUID(),
      timestamp: new Date(),
      path: path,
      method: method,
      data: payload,
      processing: false,
      cancelled: false,
    }
  }), [db.requests])


  // TODO(msfstef): better query builder for left joins
  const { results: requests = [] } = useLiveQuery(db.liveRaw({
    sql: `
    SELECT
        r.timestamp AS request_timestamp,
        r.path AS request_path,
        r.method AS request_method,
        r.data AS request_data,
        r.processing AS request_processing,
        r.cancelled AS request_cancelled,
        rs.timestamp AS response_timestamp,
        rs.status_code AS response_status_code,
        rs.data AS response_data
    FROM
        requests r
    LEFT JOIN
        responses rs ON r.id = rs.request_id
    ORDER BY
        r.timestamp DESC
    LIMIT
        10;
    `
  }))

  // const cancelRequest = useCallback(
  //   (requestId: string) => db.requests.update({
  //     data: { cancelled: true },
  //     where: {id: requestId }
  //   }),
  //   [db.requests]
  // )

  return (
    <Box>
      <Paper>
        <RequestFormView
          methods={Object.values(HttpMethod)}
          paths={paths}
          onSend={sendRequest}
        />
      </Paper>
      <Paper>
        <RequestAuditLogView
          header={[]}
          rows={requests.map((r: object) => Object.values(r))}
        />
      </Paper>
    </Box>
  )
}

