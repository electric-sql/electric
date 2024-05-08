import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DataEditor,
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  Theme,
} from '@glideapps/glide-data-grid'

export interface DataTableProps {
  rows: Record<string, unknown>[]
  columnNames: string[]
}

const getDataEditorTheme = (elem: Element | null): Partial<Theme> => {
  if (!elem) return {}
  const style = getComputedStyle(elem)
  const styleVar = (name: string): string => style.getPropertyValue(name)

  const textColor = styleVar('--gray-12')
  const textColorLight = styleVar('--gray-12')
  const surfaceColor = styleVar('--gray-surface')
  const borderColor = styleVar('--gray-7')
  return {
    accentColor: styleVar('--accent-6'),
    accentFg: styleVar('--accent-7'),
    accentLight: styleVar('--accent-a3'),

    textDark: textColor,
    textMedium: textColorLight,
    textLight: textColorLight,
    textBubble: textColor,
    textHeader: textColor,
    textGroupHeader: textColor,
    textHeaderSelected: textColorLight,
    bgCell: styleVar('--gray-5'),
    bgCellMedium: styleVar('--gray-6'),

    bgHeader: styleVar('--accent-4'),
    bgHeaderHovered: styleVar('--accent-5'),
    bgHeaderHasFocus: styleVar('--accent-6'),

    bgBubble: surfaceColor,
    bgBubbleSelected: surfaceColor,
    bgSearchResult: surfaceColor,

    borderColor: borderColor,
    horizontalBorderColor: borderColor,
    drilldownBorder: borderColor,
  }
}

export const DataTable = ({ rows, columnNames }: DataTableProps) => {
  const containerRef = useRef(null)
  const [key, setKey] = useState('')
  const [columnDefs, setColumnDefs] = useState<GridColumn[]>(
    columnNames.map((cn) => ({
      title: cn,
      id: cn,
      grow: 1,
      width: 100,
      hasMenu: false,
    })),
  )

  const theme = useMemo(
    () => getDataEditorTheme(containerRef.current),
    [containerRef.current],
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
    setKey('' + Math.random())
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
    <div key={key} ref={containerRef} style={{ height: '100%', width: '100%' }}>
      <DataEditor
        width="100%"
        height="100%"
        theme={theme}
        getCellContent={getCellContent}
        rows={rows.length}
        getCellsForSelection
        onColumnResize={(_, newSize, colIndex) =>
          setColumnDefs(
            columnDefs.map((c, idx) =>
              colIndex === idx ? { ...c, width: newSize, grow: 0 } : c,
            ),
          )
        }
        columns={columnDefs}
      />
    </div>
  )
}
