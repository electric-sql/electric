import React, { useCallback, useEffect, useState } from 'react'
import {
  DataEditor,
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
} from '@glideapps/glide-data-grid'

export interface DataTableProps {
  rows: Record<string, unknown>[]
  columnNames: string[]
}

export const DataTable = ({ rows, columnNames }: DataTableProps) => {
  const [columnDefs, setColumnDefs] = useState<GridColumn[]>(
    columnNames.map((cn) => ({
      title: cn,
      id: cn,
      grow: 1,
      width: 100,
      hasMenu: false,
    })),
  )

  // show all values as text for simplicity
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

  // reset column defs when different set provided
  useEffect(() => {
    setColumnDefs(
      columnNames.map((cn) => ({
        title: cn,
        id: cn,
        grow: 1,
        width: 100,
        hasMenu: false,
      })),
    )
  }, [columnNames])

  return (
    <DataEditor
      width="100%"
      height="100%"
      getCellContent={getCellContent}
      rows={rows.length}
      getCellsForSelection
      onColumnResize={(_, newSize, colIndex) =>
        setColumnDefs((columnDefs) =>
          columnDefs.map((c, idx) =>
            colIndex === idx ? { ...c, width: newSize, grow: 0 } : c,
          ),
        )
      }
      columns={columnDefs}
    />
  )
}
