import {
  Typography,
  Box,
  CircularProgress,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableFooter,
  TablePagination,
} from '@mui/material'
import TablePaginationActions from '@mui/material/TablePagination/TablePaginationActions'
import { ReactNode } from 'react'

export interface RequestResponseRow extends Record<string, unknown> {
  processing: boolean
}

interface ColumnDef {
  title: string
  width?: number
  accessorKey: string
  render?: (row: RequestResponseRow) => ReactNode
}

interface PaginationState {
  pageIndex: number
  pageSize: number
}

const columns: ColumnDef[] = [
  {
    title: 'Request Time',
    width: 200,
    accessorKey: 'requestTime',
  },
  {
    title: 'Path',
    accessorKey: 'path',
    width: 150,
  },
  {
    title: 'Method',
    accessorKey: 'method',
    width: 90,
  },
  {
    title: 'Payload',
    accessorKey: 'payload',
    width: 150,
  },
  {
    title: 'Status Code',
    width: 100,
    accessorKey: 'responseStatus',
  },
  {
    title: 'Response Data',
    accessorKey: 'responseData',
    width: 300,
  },
  {
    title: '',
    accessorKey: '',
    width: 20,
    render: (row) => (row.processing ? <CircularProgress size={'1rem'} /> : ''),
  },
]

export const RequestAuditLogView = ({
  rows = [],
  totalNumberOfRows,
  pagination,
  onPaginationChange,
}: {
  rows?: RequestResponseRow[]
  totalNumberOfRows?: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
}) => {
  return (
    <Box>
      <Typography variant="h5" sx={{ p: 2 }}>
        Request Audit Log
      </Typography>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {columns.map((column, index) => (
                <TableCell key={index}>{column.title}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={rowIndex} sx={{ opacity: row.cancelled ? 0.5 : 1 }}>
                {columns.map((column, index) => (
                  <TableCell
                    key={index}
                    sx={{
                      minWidth: column.width,
                      maxWidth: column.width,
                      whiteSpace: 'nowrap',
                      overflowX: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                    {column.render?.(row) ??
                      (row[column.accessorKey] !== null ? row[column.accessorKey] + '' : null)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>

          <TableFooter>
            <TableRow>
              <TablePagination
                rowsPerPageOptions={[5, 10, 20, 50, 100]}
                count={totalNumberOfRows ?? rows.length}
                rowsPerPage={pagination.pageSize}
                page={pagination.pageIndex}
                onPageChange={(_, newPageIndex) =>
                  onPaginationChange({
                    ...pagination,
                    pageIndex: newPageIndex,
                  })
                }
                onRowsPerPageChange={(event) =>
                  onPaginationChange({
                    pageIndex: 0,
                    pageSize: parseInt(event.target.value, 10),
                  })
                }
                ActionsComponent={TablePaginationActions}
              />
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </Box>
  )
}
