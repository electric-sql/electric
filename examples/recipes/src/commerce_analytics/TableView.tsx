
import {
  Box, Paper,
  Table, TableBody, TableCell,
  TableContainer, TableFooter,
  TableHead, TablePagination, TableRow, TableSortLabel
} from "@mui/material"
import TablePaginationActions from "@mui/material/TablePagination/TablePaginationActions";
import { useCallback, useMemo } from "react";


export interface PaginationState {
  pageIndex: number,
  pageSize: number
}

export interface SortingState {
  field: string,
  order?: 'asc' | 'desc'
}


export type ColumnDef = {
  field: string,
  headerName: string,
  type: 'date' | 'number' | 'text',
  format?: (val: any) => string,
  width?: number
}

export const TableView = ({
  columns,
  rows,
  totalNumberOfRows,
  sorting = [],
  onSortingChange,
  pagination,
  onPaginationChange,
} : {
  columns: ColumnDef[],
  rows: Record<string, any>[],
  totalNumberOfRows?: number,
  sorting?: SortingState[],
  onSortingChange?: (sorting: SortingState[]) => void,
  pagination: PaginationState,
  onPaginationChange: (pagination: PaginationState) => void,
}) => {
  // Avoid a layout jump when reaching the last page with empty rows.
  const emptyRows = pagination.pageSize - rows.length;

  const sortMap = useMemo(() => sorting.reduce(
    (sortMap, sortState, idx) => ({
      ...sortMap,
      [sortState.field]: { ...sortState, index: idx }
    }),
    {} as Record<string, SortingState & {index: number}>
  ), [sorting])

  const toggleSorting = useCallback((field: string) => {
    const sortState = sortMap[field]
    const index = sortState?.index ?? Infinity
    let newSortOrder;
    switch (sortState?.order) {
      case 'desc':
        newSortOrder = undefined
        break
      case 'asc':
        newSortOrder = 'desc'
        break
      default:
        newSortOrder = 'asc'
    }
    onSortingChange?.([
      ...sorting.slice(0, index),
      ...(
        !!newSortOrder ?
          [{ field, order: newSortOrder } as SortingState]
          :
          []
      ),
      ...sorting.slice(index + 1)
    ])
  }, [sorting])

  return (
    <TableContainer>
      <Table sx={{ whiteSpace: 'nowrap' }}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell
                key={column.field}
                sx={{ width: column.width }}
                sortDirection={sortMap[column.field]?.order}
              >
                <TableSortLabel
                  active={!!sortMap[column.field]?.order}
                  direction={sortMap[column.field]?.order}
                  onClick={() => toggleSorting(column.field)}
                >
                  {column.headerName}
                </TableSortLabel>
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
                  {(column.format ?? ((v: any) => v !== null ? '' + v : ''))
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