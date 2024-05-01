import React from 'react'
import { ToolbarInterface } from './api/interface'

import { Tabs } from '@radix-ui/themes'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'
import ShapesTab from './tabs/ShapesTab'

export type ToolbarTabsProps = {
  dbName: string
  api: ToolbarInterface
}

export default function ToolbarTabs({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  return (
    <Tabs.Root orientation="vertical" defaultValue="status">
      <Tabs.List>
        <Tabs.Trigger value="status">Connection</Tabs.Trigger>
        <Tabs.Trigger value="db">Local DB</Tabs.Trigger>
        <Tabs.Trigger value="shapes">Shapes</Tabs.Trigger>
        <Tabs.Trigger value="sql">Shell</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="status">
        <StatusTab dbName={dbName} api={api} />
      </Tabs.Content>
      <Tabs.Content value="db">
        <LocalDBTab dbName={dbName} api={api} />
      </Tabs.Content>
      <Tabs.Content value="shapes">
        <ShapesTab dbName={dbName} api={api} />
      </Tabs.Content>
      <Tabs.Content value="sql">
        <SQLTab dbName={dbName} api={api} />
      </Tabs.Content>
    </Tabs.Root>
  )
}
