import { useMemo } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
export interface PaginationState {
  pageIndex: number
  pageSize: number
}

export interface SortingState {
  field: string
  order?: 'asc' | 'desc'
}

export const useTableData = ({
  sorting = [],
  pagination,
  whereClause = '1=1',
}: {
  sorting: SortingState[]
  pagination: PaginationState
  whereClause?: string
}) => {
  const { db } = useElectric()!

  // Build the ORDER BY clause from the sorting state
  const orderByClause = useMemo(() => {
    const sortStatements = sorting
      .filter((sortState) => !!sortState.order)
      .map((sortState) => `${sortState.field} ${sortState.order}`)
    return sortStatements.length > 0 ? `ORDER BY ${sortStatements.join(',')}` : ''
  }, [sorting])

  // Get the order data for the given query
  const { results: orders = [] } = useLiveQuery(
    db.liveRawQuery({
      sql: `
      SELECT * FROM commerce_orders
      WHERE ${whereClause}
      ${orderByClause}
      LIMIT ${pagination.pageSize}
      OFFSET ${pagination.pageIndex * pagination.pageSize}
    `,
    }),
  )

  // Also get a count for the total data matching the filters
  // such that pagination can be handled correctly
  const totalNumberOfOrders =
    useLiveQuery(
      db.liveRawQuery({
        sql: `
      SELECT COUNT(*) AS count FROM commerce_orders
      WHERE ${whereClause};
    `,
      }),
    ).results?.[0]?.count ?? 0
  return {
    orders,
    totalNumberOfOrders,
  }
}
