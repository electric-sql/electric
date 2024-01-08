import { Box, Paper } from "@mui/material"
import { useLiveQuery } from "electric-sql/react"
import { useElectric } from "../electric/ElectricWrapper"
import { useMemo, useState } from "react";
import { PaginationState, SortingState, TableView } from "./TableView";
import { columns } from "./commerce_orders_columns";
import { QueryBuilder } from "./QueryBuilder";

export const CommerceAnalytics = () => {
  const [ pagination, setPagination ] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10
  })
  
  const [ whereClause, setWhereClause ] = useState('1 = 1')
  
  const [ sorting, setSorting ] = useState<SortingState[]>([])
  const orderByClause = useMemo(() => {
    const sortStatements = sorting
      .filter((sortState) => !!sortState.order)
      .map((sortState) => `${sortState.field} ${sortState.order}`)
    return sortStatements.length > 0 ? `ORDER BY ${sortStatements.join(',')}` : ''
  }, [sorting])

  const { db } = useElectric()!
  const { results: orders = [] } = useLiveQuery(db.liveRaw({
    sql: `
      SELECT * FROM commerce_orders
      WHERE ${whereClause}
      ${orderByClause}
      LIMIT ${pagination.pageSize}
      OFFSET ${pagination.pageIndex * pagination.pageSize}
    `
  }))
  const totalNumOrders = useLiveQuery(db.liveRaw({
    sql: `
      SELECT COUNT(*) FROM commerce_orders
      WHERE ${whereClause};
    `
  })).results?.[0]?.['COUNT(*)'] ?? 0

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ mb: 2 }}>
        <QueryBuilder
          columns={columns}
          onQueryChanged={setWhereClause}
          />
      </Box>
      <TableView
        columns={columns}
        rows={orders}
        totalNumberOfRows={totalNumOrders}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
      />
    </Paper>
  )
}