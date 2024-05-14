import React from 'react'
import { ToolbarInterface } from './api/interface'

import { Box, Tabs } from '@radix-ui/themes'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'
import ShapesTab from './tabs/ShapesTab'
import InspectTableTab from './tabs/InspectTableTab'

export type ToolbarTabsProps = {
  dbName: string
  api: ToolbarInterface
}

export default function ToolbarTabs({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const tabContentHeight = '100%'
  return (
    <Tabs.Root orientation="vertical" defaultValue="status">
      <Tabs.List>
        <Tabs.Trigger value="status">Connection</Tabs.Trigger>
        <Tabs.Trigger value="db">Local DB</Tabs.Trigger>
        <Tabs.Trigger value="shapes">Shapes</Tabs.Trigger>
        <Tabs.Trigger value="inspect">Inspect Tables</Tabs.Trigger>
        <Tabs.Trigger value="sql">Shell</Tabs.Trigger>
      </Tabs.List>
      <Box p="2" height="40vh">
        <Tabs.Content value="status" style={{ height: tabContentHeight }}>
          <StatusTab dbName={dbName} api={api} />
        </Tabs.Content>
        <Tabs.Content value="db" style={{ height: tabContentHeight }}>
          <LocalDBTab dbName={dbName} api={api} />
        </Tabs.Content>
        <Tabs.Content value="shapes" style={{ height: tabContentHeight }}>
          <ShapesTab dbName={dbName} api={api} />
        </Tabs.Content>
        <Tabs.Content value="inspect" style={{ height: tabContentHeight }}>
          <InspectTableTab dbName={dbName} api={api} />
        </Tabs.Content>
        <Tabs.Content value="sql" style={{ height: tabContentHeight }}>
          <SQLTab dbName={dbName} api={api} />
        </Tabs.Content>
      </Box>
    </Tabs.Root>
  )
}
