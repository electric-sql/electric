import { Paper, Typography,
  TableContainer, Table, TableHead,
  TableRow, TableCell, TableBody
} from "@mui/material"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"
import { useEffect, useState } from "react"


export const CalculatorAuditLog = () => {
  const [ rows, setRows ] = useState<string[][]>([[]]);
  const { db } = useElectric()!

  // Find 5 most recent requests made
  const { results: requests = [] } = useLiveQuery(db.requests.liveMany({
    select: {
      id: true,
      timestamp: true,
      data: true,
      processing: true,
      cancelled: true,
    },
    orderBy: {
      timestamp: 'desc',
    },
    take: 5,
  }))


  // Format the requests into table rows, and match them to responses
  // if present
  useEffect(() => {
    const generateRows = async () => {
      const newRows = await Promise.all(requests.map(async (request) => {
        const timestamp = request.timestamp.toISOString()

        const summands = (
          JSON.parse(request.data?.toString() ?? '{}') as { summands: number[] }
        ).summands;
          
        const formattedSummands = summands.map(
            (summand, idx) => idx == 0 ?
              `${summand}` :
              (summand < 0 ?
                ` - ${Math.abs(summand)}` :
                ` + ${Math.abs(summand)}`
              )
        ).join('')

        let result: string;
        if (request.cancelled) {
          result = 'cancelled'
        } else if (request.processing) {
          result = 'processing'
        } else {
          // match request to response, if there is one
          const responseData = ((await db.responses.findFirst({
            select: {
              data: true,
            },
            where: {
                request_id: request.id
            }
          }))?.data ?? {}) as { sum?: number }

          result = responseData.sum?.toString() ?? 'requested'
        }

        return [timestamp, formattedSummands, result]
    }))
    setRows(newRows);
  };

  generateRows();
  }, [db.responses, requests])

  return (
    <CalculatorAuditLogView
      header={['Date', 'Operation', 'Result']}
      rows={rows}
    />
  )
}

const CalculatorAuditLogView = ({ header, rows } : { header: string[], rows: string[][] }) => {
  return (
    <TableContainer component={Paper} sx={{ maxWidth: 600, margin: 'auto' }}>
      <Typography variant="h5" sx={{ p: 2 }}>
        Request Audit Log
      </Typography>
      <Table>
        <TableHead>
          <TableRow>
            { header.map((headerVal, index) => <TableCell key={index}>{headerVal}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          { rows.map((rowVals, rowIndex) => (
            <TableRow key={rowIndex}>
              { rowVals.map((rowVal, index) => <TableCell sx={{ minWidth: 100}} key={index}>{rowVal}</TableCell>)}
            </TableRow>
          )) }
        </TableBody>
      </Table>
    </TableContainer>
  )
}