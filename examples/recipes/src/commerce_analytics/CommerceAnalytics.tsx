import { Box, Paper } from "@mui/material"
import { useLiveQuery } from "electric-sql/react"
import { useElectric } from "../electric/ElectricWrapper"
import {
  DataGrid, GridColDef,
  GridFilterModel,
  GridPaginationModel, GridSortModel,
  getGridDateOperators,
  getGridNumericOperators,
  getGridStringOperators
} from "@mui/x-data-grid"
import { Commerce_orders } from "../generated/client";
import { useCallback, useState } from "react";


export const CommerceAnalytics = () => {
  const [ orderBy, setOrderBy ] = useState({})
  const [ paginationState, setPaginationState ] = useState<PaginationState>({
    take: 100,
    skip: 0
  })
  const [ filter, setFilter ] = useState({})
  const { db } = useElectric()!

  const totalNumOrders = useLiveQuery(db.liveRaw({
    sql: `SELECT COUNT(*) FROM commerce_orders;`
  })).results?.[0]?.['COUNT(*)'] ?? 0

  const { results: orders = [] } = useLiveQuery(db.commerce_orders.liveMany({
    orderBy:  orderBy,
    where: filter,
    take: paginationState?.take,
    skip: paginationState?.skip
  }))


  const updateQueryOrdering = useCallback(
    (sortModel: GridSortModel) => {
      return setOrderBy(sortModel.map((sortEntry) => ({
        [sortEntry.field]: sortEntry.sort
      })))
    },
    []
  )

  const updateQueryFiltering = useCallback(
    (filterModel: GridFilterModel) => {
      // reset to first page after filtering
      setPaginationState({ ...paginationState, skip: 0 })

      // transform filters appropriately
      const transformedFilterItems = filterModel.items
        .filter((filterItem) => filterItem.value !== undefined )
        .map((filterItem) => {
          const mappedOperator = filterOperatorMap[filterItem.operator]
          const mappedValue = isNaN(filterItem.value) ?
            filterItem.value :
            isNaN(parseFloat(filterItem.value)) ?
              filterItem.value : parseFloat(filterItem.value)
          return {
            [filterItem.field]: mappedOperator === 'equals' ?
              mappedValue :
              { [mappedOperator]: mappedValue }
          }
        })
      if (transformedFilterItems.length === 0) {
        return setFilter({})
      }
      return setFilter({
        [filterModel.logicOperator?.toUpperCase() ?? 'OR']: transformedFilterItems
      })
    },
    [paginationState]
  )

  const updatePaginationState = useCallback(
    (paginationModel: GridPaginationModel) => {
      return setPaginationState({
        take: paginationModel.pageSize,
        skip: paginationModel.page * paginationModel.pageSize
      })
    },
    []
  )


  return (
    <Paper>
      <CommerceAnalyticsTable
        rows={orders}
        totalNumberOfRows={totalNumOrders}
        paginationState={paginationState}
        onSortModelChange={updateQueryOrdering}
        onFilterModelChange={updateQueryFiltering}
        onPaginationModelChange={updatePaginationState}
      />
    </Paper>
  )
}




const filterOperatorMap: Record<string, string> = {
  '=': 'equals',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  'equals': 'equals',
  'startsWith': 'startsWith',
  'endsWith': 'endsWith',
  'contains': 'contains',
  'isAnyOf': 'in',
  'is': 'equals',
  'after': 'gt',
  'onOrAfter': 'gte',
  'before': 'lt',
  'onOrBefore': 'lte',
}


const numericFilterOperators = getGridNumericOperators()
  .filter((o) => filterOperatorMap[o.value] !== undefined)
const stringFilterOperators = getGridStringOperators()
  .filter((o) => filterOperatorMap[o.value] !== undefined)
const dateFilterOperators = getGridDateOperators()
  .filter((o) => filterOperatorMap[o.value] !== undefined)


interface PaginationState {
  take: number,
  skip: number
}

const columns: GridColDef[] = [
  {
    field: 'order_id',
    headerName: 'Order ID',
    filterable: false,
    sortable: false,
    width: 160,
  },
  {
    field: 'timestamp',
    headerName: 'Timestamp',
    type: 'dateTime',
    valueFormatter: (v) => (v.value as Date)?.toLocaleString(),
    filterOperators: dateFilterOperators,
    width: 200,
  },
  {
    field: 'price_amount_cents',
    headerName: 'Price',
    type: 'number',
    valueFormatter: (v) => isNaN(v.value) ? null : (v.value as number) / 100,
    filterOperators: numericFilterOperators,
    width: 110
  },
  {
    field: 'price_currency',
    headerName: 'Currency',
    filterOperators: stringFilterOperators,
    width: 80
  },
  {
    field: 'promo_code',
    headerName: 'Promo Code',
    filterOperators: stringFilterOperators,
    width: 120
  },
  {
    field: 'customer_full_name',
    headerName: 'Customer',
    filterOperators: stringFilterOperators,
    width: 150
  },
  {
    field: 'country',
    headerName: 'Country',
    filterOperators: stringFilterOperators,
    width: 150
  },
  {
    field: 'city',
    headerName: 'City',
    filterOperators: stringFilterOperators,
    width: 150
  },
];

const CommerceAnalyticsTable = ({
  rows,
  totalNumberOfRows,
  paginationState,
  onSortModelChange,
  onFilterModelChange,
  onPaginationModelChange,
} : {
  rows: Partial<Commerce_orders>[]
  totalNumberOfRows?: number,
  paginationState: PaginationState,
  onSortModelChange?: (model: GridSortModel) => void,
  onFilterModelChange?: (model: GridFilterModel) => void,
  onPaginationModelChange?: (model: GridPaginationModel) => void,

}) => {
  return (
    <Box sx={{ height: '70vh', width: '100%' }}>
      <DataGrid
        getRowId={(row) => row.order_id}
        rows={rows}
        columns={columns}
        rowCount={totalNumberOfRows}
        paginationMode="server"
        onPaginationModelChange={onPaginationModelChange}
        paginationModel={{
          pageSize: paginationState.take,
          page: Math.floor(
            paginationState.skip /
            paginationState.take
          ),
        }}
        sortingMode="server"
        onSortModelChange={onSortModelChange}
        filterMode="server"
        onFilterModelChange={onFilterModelChange}
        disableRowSelectionOnClick
      />
    </Box>
  )
}