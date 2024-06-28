import React, { useEffect, useMemo, useState } from 'react'
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
import { DbTableInfo } from '../api/interface'
import { DataTable } from '../components/DataTable'

export default function InspectTableTab({ dbName, api }: ToolbarTabsProps) {
  const [tables, setTables] = useState<DbTableInfo[] | null>(null)
  const [tableInfo, setTableInfo] = useState<DbTableInfo | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const columnNames = useMemo(
    () => (tableInfo !== null ? tableInfo.columns.map((c) => c.name) : []),
    [tableInfo],
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
        <DataTable rows={rows} columnNames={columnNames} />
      </Flex>
    </Flex>
  )
}
