import React, { useEffect, useState } from 'react'
import { UnControlled as CodeMirrorUnControlled } from 'react-codemirror2'
import { format } from 'sql-formatter'
import { ToolbarTabsProps } from '../tabs'
import {
  Badge,
  Box,
  Button,
  Card,
  DataList,
  Flex,
  Heading,
  HoverCard,
  Skeleton,
  Strong,
  Table,
  Tooltip,
} from '@radix-ui/themes'
import { DbTableInfo } from '../api/interface'
import { getToolbarElem } from '../utils/portal'

export default function LocalDBTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [resettingDb, setResettingDb] = useState(false)
  const [dbTables, setDbTables] = useState<DbTableInfo[] | null>(null)
  const [electricTables, setElectricTables] = useState<DbTableInfo[] | null>(
    null,
  )
  useEffect(() => {
    let cancelled = false
    api.getDbTables(dbName).then((tables) => !cancelled && setDbTables(tables))
    api
      .getElectricTables(dbName)
      .then((tables) => !cancelled && setElectricTables(tables))
    return () => {
      cancelled = true
    }
  }, [dbName, api])

  return (
    <Box>
      <DataList.Root>
        <DataList.Item align="center">
          <DataList.Label>Database Name</DataList.Label>
          <DataList.Value>
            <Flex gap="3" align="center">
              <Strong>{dbName}</Strong>
              <Tooltip content="Deletes local IndexedDB and refreshes page">
                <Button
                  size="1"
                  variant="soft"
                  color="orange"
                  loading={resettingDb}
                  onClick={() => {
                    setResettingDb(true)
                    api.resetDb(dbName)
                  }}
                >
                  RESET
                </Button>
              </Tooltip>
            </Flex>
          </DataList.Value>
        </DataList.Item>

        <TableDataItem label="Database Tables" tables={dbTables} />
        <TableDataItem label="Internal Tables" tables={electricTables} />
      </DataList.Root>
    </Box>
  )
}

const TableDataItem = ({
  label,
  tables,
}: {
  label: string
  tables: DbTableInfo[] | null
}) => {
  return (
    <DataList.Item align="center">
      <DataList.Label>{label}</DataList.Label>
      <DataList.Value>
        <Flex gap="2" wrap="wrap">
          {tables === null ? (
            <Skeleton loading>table1, table2, table3</Skeleton>
          ) : (
            tables.map((tblInfo) => (
              <HoverCard.Root key={tblInfo.name}>
                <HoverCard.Trigger>
                  <Badge size="2" color="gray" highContrast>
                    {tblInfo.name}
                  </Badge>
                </HoverCard.Trigger>

                <HoverCard.Content asChild container={getToolbarElem()}>
                  <Card>
                    <Flex direction="column" minWidth="100px" gap="3">
                      <Heading>Schema</Heading>
                      {tblInfo.sql ? (
                        <CodeMirrorUnControlled
                          value={format(tblInfo.sql, {
                            language: 'sqlite',
                            tabWidth: 2,
                            expressionWidth: 20,
                          })}
                          options={{
                            readOnly: true,
                            tabSize: 2,
                            mode: 'sql',
                            theme: 'material',
                            lineNumbers: false,
                          }}
                        />
                      ) : (
                        <Table.Root>
                          <Table.Header>
                            <Table.Row>
                              <Table.ColumnHeaderCell>
                                Column Name
                              </Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>
                                Type
                              </Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>
                                Nullable
                              </Table.ColumnHeaderCell>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body>
                            {tblInfo.columns.map((col) => (
                              <Table.Row key={col.name}>
                                <Table.Cell>{col.name}</Table.Cell>
                                <Table.Cell>
                                  {col.type?.toUpperCase()}
                                </Table.Cell>
                                <Table.Cell>
                                  {col.nullable ? 'YES' : 'NO'}
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Root>
                      )}
                    </Flex>
                  </Card>
                </HoverCard.Content>
              </HoverCard.Root>
            ))
          )}
        </Flex>
      </DataList.Value>
    </DataList.Item>
  )
}
