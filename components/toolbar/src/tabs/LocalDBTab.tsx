import React from 'react'
import { ToolbarTabsProps } from '../tabs'
import { Box, Button, DataList, Strong } from '@radix-ui/themes'

export default function LocalDBTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  return (
    <Box>
      <DataList.Root>
        <DataList.Item>
          <DataList.Label>Database Name</DataList.Label>
          <DataList.Value>
            <Strong>{dbName}</Strong>
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Reset Database</DataList.Label>
          <DataList.Value>
            <Button onClick={() => api.resetDb(dbName)}>RESET</Button>
          </DataList.Value>
        </DataList.Item>
      </DataList.Root>
    </Box>
  )
}
