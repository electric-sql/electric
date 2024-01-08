import { Paper } from "@mui/material"
import { useLiveQuery } from "electric-sql/react"
import { useElectric } from "../electric/ElectricWrapper"
import { useState } from "react";
import { TableView } from "./TableView";
import { columns } from "./commerce_orders_columns";


export const CommerceAnalytics = () => {
  const [ orderBy, setOrderBy ] = useState({})
  const [ paginationState, setPaginationState ] = useState({
    pageIndex: 0,
    pageSize: 10
  })
  const [ filter, setFilter ] = useState({})
  const { db } = useElectric()!

  const totalNumOrders = useLiveQuery(db.liveRaw({
    sql: `SELECT COUNT(*) FROM commerce_orders;`
  })).results?.[0]?.['COUNT(*)'] ?? 0

  const { results: orders = [] } = useLiveQuery(db.commerce_orders.liveMany({
    orderBy:  orderBy,
    where: filter,
    take: paginationState.pageSize,
    skip: paginationState.pageIndex * paginationState.pageSize
  }))


  return (
    <Paper>
      <TableView
        columns={columns}
        rows={orders}
        totalNumberOfRows={totalNumOrders}
        pagination={paginationState}
        onPaginationChange={setPaginationState}
      />
    </Paper>
  )
}