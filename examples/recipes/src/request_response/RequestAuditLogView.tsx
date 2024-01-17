import { Paper, Typography,
  TableContainer, Table, TableHead,
  TableRow, TableCell, TableBody
} from "@mui/material"

export const RequestAuditLogView = ({ header, rows } : { header: string[], rows: string[][] }) => {
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