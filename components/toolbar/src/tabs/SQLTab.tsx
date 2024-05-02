import React, { useMemo, useState } from 'react'
import {
  Controlled as CodeMirrorControlled,
  UnControlled as CodeMirrorUnControlled,
} from 'react-codemirror2'
import { ToolbarTabsProps } from '../tabs'
import {
  DataEditor,
  GridCell,
  GridCellKind,
  Item,
} from '@glideapps/glide-data-grid'
import { Button, Callout, Flex, Grid, ScrollArea, Tabs } from '@radix-ui/themes'

export default function SQLTab({ dbName, api }: ToolbarTabsProps): JSX.Element {
  const [code, setCode] = useState(
    'SELECT name FROM sqlite_schema\n' +
      "WHERE type='table'\n" +
      'ORDER BY name;',
  )
  const [response, setResponse] = useState<Record<string, any>[] | string>([])
  const isError = useMemo(() => typeof response === 'string', [response])
  const columnNames = useMemo(
    () => (response.length > 0 ? Object.keys(response[0]) : []),
    [response],
  )
  const [history, setHistory] = useState('')

  function submitSQL() {
    setHistory(history + code + '\n\n')
    api.queryDb(dbName, { sql: code }).then(
      (rows) => setResponse(rows),
      (err) => setResponse('Error: ' + err.message),
    )
  }

  function clearHistory() {
    setHistory('')
  }

  const getCellContent = (cell: Item): GridCell => {
    const [col, row] = cell
    const dataRow = response[row] as Record<string, any>
    const d = dataRow[columnNames[col]]
    return {
      kind: GridCellKind.Text,
      allowOverlay: false,
      displayData: String(d),
      data: String(d),
    }
  }

  return (
    <Grid
      columns="minmax(300px, 33%) 1fr"
      gap="3"
      rows="1"
      width="auto"
      height="100%"
    >
      <Tabs.Root defaultValue="query">
        <Tabs.List mb="1">
          <Tabs.Trigger value="query">Query</Tabs.Trigger>
          <Tabs.Trigger value="history">History</Tabs.Trigger>
        </Tabs.List>
        <FixedSizeTabContent value="query">
          <ScrollArea style={{ height: '100%' }}>
            <CodeMirrorControlled
              value={code}
              onBeforeChange={(_editor, _data, value) => {
                setCode(value)
              }}
              options={{
                tabSize: 4,
                mode: 'sql',
                theme: 'material',
                lineNumbers: true,
              }}
            />
          </ScrollArea>
          <Flex justify="end" style={{ backgroundColor: '#263238' }}>
            <Button m="2" onClick={submitSQL}>
              SUBMIT
            </Button>
          </Flex>
        </FixedSizeTabContent>
        <FixedSizeTabContent value="history">
          <ScrollArea style={{ height: '100%' }}>
            <CodeMirrorUnControlled
              value={history}
              options={{
                readOnly: true,
                tabSize: 4,
                mode: 'sql',
                theme: 'material',
                lineNumbers: false,
              }}
            />
          </ScrollArea>
          <Flex justify="end" style={{ backgroundColor: '#263238' }}>
            <Button m="2" onClick={clearHistory}>
              CLEAR
            </Button>
          </Flex>
        </FixedSizeTabContent>
      </Tabs.Root>
      <Tabs.Root defaultValue="table">
        <Tabs.List mb="1">
          <Tabs.Trigger value="table">Table</Tabs.Trigger>
          <Tabs.Trigger value="json">JSON</Tabs.Trigger>
        </Tabs.List>
        <FixedSizeTabContent value="table">
          {typeof response !== 'string' && response.length > 0 ? (
            <DataEditor
              width="100%"
              getCellContent={getCellContent}
              rows={response.length}
              getCellsForSelection
              columns={columnNames.map((cn) => ({
                title: cn,
                id: cn,
                grow: 1,
                hasMenu: false,
              }))}
            />
          ) : (
            <Callout.Root color={isError ? 'red' : undefined}>
              <Callout.Text>
                {isError ? (response as string) : 'No data to show'}
              </Callout.Text>
            </Callout.Root>
          )}
        </FixedSizeTabContent>

        <FixedSizeTabContent value="json">
          <ScrollArea style={{ height: '100%' }}>
            <CodeMirrorUnControlled
              value={JSON.stringify(response, null, 2)}
              options={{
                readOnly: true,
                tabSize: 4,
                mode: 'json',
                theme: 'material',
              }}
            />
          </ScrollArea>
        </FixedSizeTabContent>
      </Tabs.Root>
    </Grid>
  )
}

const FixedSizeTabContent = ({
  children,
  value,
}: {
  children: React.ReactNode
  value: string
}) => (
  <Tabs.Content value={value} asChild>
    {/* Hacky way to ensure tab content is scrollable */}
    <Flex direction="column" height="calc(100% - 40px)">
      {children}
    </Flex>
  </Tabs.Content>
)
