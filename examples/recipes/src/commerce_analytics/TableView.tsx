
import {
  Box, Paper,
  Table, TableBody, TableCell,
  TableContainer, TableFooter,
  TableHead, TablePagination, TableRow
} from "@mui/material"
import TablePaginationActions from "@mui/material/TablePagination/TablePaginationActions";


export interface PaginationState {
  pageIndex: number,
  pageSize: number
}


export type ColumnDef = {
  field: string,
  headerName: string,
  format?: (val: any) => string,
  width?: number
}

export function TableView({
  columns,
  rows,
  totalNumberOfRows,
  pagination,
  onPaginationChange,
} : {
  columns: ColumnDef[],
  rows: Record<string, any>[],
  totalNumberOfRows?: number,
  pagination: PaginationState,
  onPaginationChange: (pagination: PaginationState) => void,
}) {
  // Avoid a layout jump when reaching the last page with empty rows.
  const emptyRows = pagination.pageSize - rows.length;
  return (
    <TableContainer>
      <Table sx={{ whiteSpace: 'nowrap' }}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.field} sx={{ width: column.width }}>
                {column.headerName}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={idx}>
              {columns.map((column) => (
                <TableCell key={column.field}
                  sx={{
                    minWidth: column.width,
                    maxWidth: column.width,
                    textOverflow: 'ellipsis',
                    overflow: 'hidden'
                  }}
                  component="th" scope="row">
                  {(column.format ?? ((v: any) => '' + v))
                    (row[column.field])
                  }
                </TableCell>
              ))}
            </TableRow>
          ))}
          {emptyRows > 0 && (
            <TableRow key="empty-rows" style={{ height: 53 * emptyRows }}>
              <TableCell colSpan={columns.length} />
            </TableRow>
          )}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TablePagination
              rowsPerPageOptions={[10, 20, 50, 100]}
              colSpan={0}
              count={totalNumberOfRows ?? rows.length}
              rowsPerPage={pagination.pageSize}
              page={pagination.pageIndex}
              onPageChange={(_, newPageIndex) => onPaginationChange({
                ...pagination,
                pageIndex: newPageIndex
              })}
              onRowsPerPageChange={(event) => onPaginationChange({
                pageIndex: 0,
                pageSize: parseInt(event.target.value, 10)
              })}
              ActionsComponent={TablePaginationActions}
            />
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  )
}