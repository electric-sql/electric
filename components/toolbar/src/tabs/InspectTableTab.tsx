import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'
import {
  Box,
  Flex,
  RadioCards,
  ScrollArea,
  Separator,
  Spinner,
  Text,
} from '@radix-ui/themes'
import {
  DataEditor,
  GridCell,
  GridCellKind,
  Item,
} from '@glideapps/glide-data-grid'
import { DbTableInfo } from 'src/api/interface'

export default function InspectTableTab({ dbName, api }: ToolbarTabsProps) {
  const [tables, setTables] = useState<DbTableInfo[] | null>(null)
  const [tableInfo, setTableInfo] = useState<DbTableInfo | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[] | string>([])
  const columnNames = useMemo(
    () => (rows.length > 0 ? Object.keys(rows[0]) : []),
    [rows],
  )

  useEffect(() => {
    let cancelled = false

    Promise.all([api.getDbTables(dbName), api.getElectricTables(dbName)]).then(
      ([dbTables, electricTables]) => {
        if (cancelled) return
        const tables = dbTables.concat(electricTables)
        setTables(tables)
        setTableInfo(tables[0])
      },
    )
    return () => {
      cancelled = true
    }
  }, [dbName, api])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: () => void
    if (tableInfo) {
      const updateTableData = () => {
        api
          .queryDb(dbName, { sql: `SELECT * FROM ${tableInfo.name}` })
          .then((rows) => !cancelled && setRows(rows))
      }
      updateTableData()
      unsubscribe = api.subscribeToDbTable(
        dbName,
        tableInfo?.name,
        updateTableData,
      )
    } else {
      setRows([])
    }
    return () => {
      unsubscribe?.()
      cancelled = true
    }
  }, [dbName, api, tableInfo])

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

  if (!tables) {
    return (
      <Flex gap="2">
        <Spinner />
        <Text>Loading tables...</Text>
      </Flex>
    )
  }

  return (
    <Flex direction="row" gap="2" height="100%" align="center">
      <Box height="100%">
        <ScrollArea style={{ height: '100%' }}>
          <RadioCards.Root
            size="1"
            value={tableInfo!.name}
            onValueChange={(tableName) =>
              setTableInfo(tables.find((tbl) => tbl.name === tableName)!)
            }
          >
            {tables
              .filter((dbInfo) => !dbInfo.name.startsWith('_electric'))
              .map((dbInfo) => (
                <RadioCards.Item key={dbInfo.name} value={dbInfo.name}>
                  {dbInfo.name}
                </RadioCards.Item>
              ))}
            <Separator style={{ width: '100%' }} />
            {tables
              .filter((dbInfo) => dbInfo.name.startsWith('_electric'))
              .map((dbInfo) => (
                <RadioCards.Item key={dbInfo.name} value={dbInfo.name}>
                  {dbInfo.name}
                </RadioCards.Item>
              ))}
          </RadioCards.Root>
        </ScrollArea>
      </Box>
      <Separator orientation="vertical" style={{ height: '100%' }} />

      <Flex height="100%" flexGrow="1">
        <DataEditor
          width="100%"
          height="100%"
          columns={tableInfo!.columns.map((c) => ({
            title: c.name,
            id: c.name,
            grow: 1,
            width: 100,
          }))}
          rows={rows.length}
          getCellsForSelection
          getCellContent={getCellContent}
        />
      </Flex>
    </Flex>
  )
}
