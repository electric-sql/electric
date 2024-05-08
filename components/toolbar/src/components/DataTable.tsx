import React, { useCallback } from 'react'
import {
  DataEditor,
  GridCell,
  GridCellKind,
  Item,
} from '@glideapps/glide-data-grid'

export interface DataTableProps {
  rows: Record<string, unknown>[]
  columnNames: string[]
}

export const DataTable = ({ rows, columnNames }: DataTableProps) => {
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const dataRow = rows[row] as Record<string, unknown>
      const d = dataRow[columnNames[col]]
      return {
        kind: GridCellKind.Text,
        allowOverlay: false,
        displayData: String(d),
        data: String(d),
      }
    },
    [rows, columnNames],
  )
  return (
    <DataEditor
      width="100%"
      height="100%"
      getCellContent={getCellContent}
      rows={rows.length}
      getCellsForSelection
      columns={columnNames.map((cn) => ({
        title: cn,
        id: cn,
        grow: 1,
        width: 100,
        hasMenu: false,
      }))}
    />
  )
}
