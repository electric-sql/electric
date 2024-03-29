import { Box, Paper } from '@mui/material'
import { useState } from 'react'
import { columns, aggregateColumns } from './commerce_orders_columns'
import { QueryBuilder } from './components/QueryBuilder'
import { TableDataViewer } from './TableDataViewer'
import { ChartDataViewer } from './ChartDataViewer'

export const DataViewer = () => {
  // Keep a where clause generated by a query builder
  const [whereClause, setWhereClause] = useState('1 = 1')

  return (
    <Paper sx={{ p: 4 }}>
      <Box sx={{ mb: 2, display: 'flex' }}>
        <Box sx={{ flex: 1, mr: 2 }}>
          <QueryBuilder columns={columns} onQueryChanged={setWhereClause} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <ChartDataViewer aggregateColumns={aggregateColumns} whereClause={whereClause} />
        </Box>
      </Box>
      <TableDataViewer columns={columns} whereClause={whereClause} />
    </Paper>
  )
}
