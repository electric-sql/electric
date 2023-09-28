import React, { useState } from 'react'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'

function TabItem(
  label: string,
  name: string,
  handleClick: (e: React.MouseEvent<HTMLLIElement>, name: string) => void,
  active: string,
): JSX.Element {
  function click(e: React.MouseEvent<HTMLLIElement>) {
    handleClick(e, name)
  }

  if (active == name) {
    return (
      <li className="Toolbar-tab-item Toolbar-tab-item-active" onClick={click}>
        {label}
      </li>
    )
  } else {
    return (
      <li className="Toolbar-tab-item" onClick={click}>
        {label}
      </li>
    )
  }
}

export type ToolbarTabsProps = {
  dbName: string
}

export default function ToolbarTabs({ dbName }: ToolbarTabsProps): JSX.Element {
  const [active, setActive] = useState('status')
  function handleClick(_e: React.MouseEvent<HTMLLIElement>, name: string) {
    setActive(name)
  }

  function renderComp() {
    switch (active) {
      case 'status':
        return <StatusTab dbName={dbName} />
      case 'db':
        return <LocalDBTab dbName={dbName} />
      case 'sql':
        return <SQLTab dbName={dbName} />
      default:
        return <StatusTab dbName={dbName} />
    }
  }

  return (
    <div className="Toolbar-tabs">
      <ul className="Toolbar-tab-items">
        {TabItem('Status', 'status', handleClick, active)}
        {TabItem('IndexDB', 'db', handleClick, active)}
        {TabItem('SQLite', 'sql', handleClick, active)}
      </ul>
      <div className="Toolbar-tab-content">{renderComp()}</div>
    </div>
  )
}
