import {
  Typography, Box, CircularProgress,
  TableContainer, Table, TableHead,
  TableRow, TableCell, TableBody
} from "@mui/material"
import { HttpMethod } from "./utilities"
import { ReactNode } from 'react'

export interface RequestResponseRow extends Record<string, unknown> {
  requestTime: Date,
  path: string,
  method: HttpMethod,
  payload?: string,
  processing: boolean,
  cancelled: boolean,
  responseTime?: Date,
  responseStatus?: number,
  responseData?: string
}

interface ColumnDef {
  title: string,
  width?: number,
  accessorKey: string,
  render?: (row: RequestResponseRow) => ReactNode
}

const columns : ColumnDef[] = [
  {
    title: 'Request Time',
    width: 200,
    accessorKey: 'requestTime',
  },
  {
    title: 'Path',
    accessorKey: 'path',
  },
  {
    title: 'Method',
    accessorKey: 'method',
  },
  {
    title: 'Payload',
    accessorKey: 'payload',
  },
  {
    title: 'Status Code',
    width: 120,
    accessorKey: 'responseStatus',
  },
  {
    title: 'Response Data',
    accessorKey: 'responseData',
  },
  {
    title: '',
    accessorKey: '',
    width: 20,
    render: (row) => (
      row.processing ?
        <CircularProgress size={'1rem'} /> :
        ''
    )
  }
];


export const RequestAuditLogView = ({ rows } : { rows: RequestResponseRow[] }) => {
  return (
    <Box>
      <Typography variant="h5" sx={{ p: 2 }}>
        Request Audit Log
      </Typography>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              { 
              columns.map((column, index) =>
                <TableCell key={index}>
                  {column.title}
                </TableCell>
              )
              }
            </TableRow>
          </TableHead>
          <TableBody>
            { rows.map((row, rowIndex) => (
              <TableRow key={rowIndex} sx={{ opacity: row.cancelled ? 0.5 : 1 }}>
                {
                columns.map((column, index) =>
                  <TableCell key={index}
                    sx={{
                      minWidth: column.width,
                      maxWidth: column.width,
                      whiteSpace: 'nowrap',
                    }}>
                    {
                    column.render?.(row) ??
                      (row[column.accessorKey] !== null ?
                        row[column.accessorKey] + '' :
                        null)
                    }
                  </TableCell>
                )
                }
              </TableRow>
            )) }
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}