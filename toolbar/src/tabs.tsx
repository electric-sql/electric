import React, { useState } from 'react'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'
import { ToolbarInterface } from './api/toolbar-interface'

function TabItem(
  label: string,
  name: 'status' | 'db' | 'sql',
  handleClick: (
    e: React.MouseEvent<HTMLLIElement>,
    name: 'status' | 'db' | 'sql',
  ) => void,
  active: string,
): JSX.Element {
  function click(e: React.MouseEvent<HTMLLIElement>) {
    handleClick(e, name)
  }

  const className =
    active == name
      ? 'Toolbar-tab-item Toolbar-tab-item-active'
      : 'Toolbar-tab-item'
  return (
    <li className={className} onClick={click}>
      {label}
    </li>
  )
}

export type ToolbarTabsProps = {
  dbName: string
  api: ToolbarInterface
}

export default function ToolbarTabs({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [active, setActive] = useState<'status' | 'db' | 'sql'>('status')
  function handleClick(
    _e: React.MouseEvent<HTMLLIElement>,
    name: 'status' | 'db' | 'sql',
  ) {
    setActive(name)
  }

  function renderComp() {
    switch (active) {
      case 'status':
        return <StatusTab dbName={dbName} api={api} />
      case 'db':
        return <LocalDBTab dbName={dbName} api={api} />
      case 'sql':
        return <SQLTab dbName={dbName} api={api} />
      default:
        return <StatusTab dbName={dbName} api={api} />
    }
  }

  return (
    <div className="Toolbar-tabs">
      <ul className="Toolbar-tab-items">
        {TabItem('Connection', 'status', handleClick, active)}
        {TabItem('Local DB', 'db', handleClick, active)}
        {TabItem('Shell', 'sql', handleClick, active)}
      </ul>
      <div className="Toolbar-tab-content">{renderComp()}</div>
    </div>
  )
}
