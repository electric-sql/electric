import React, { useState } from 'react'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'
import { ToolbarInterface } from './api/interface'
import ShapesTab from './tabs/ShapesTab'
import clsx from 'clsx'
import style from './index.module.css'

type TabName = 'status' | 'db' | 'sql' | 'shapes'

function TabItem(
  label: string,
  name: TabName,
  handleClick: (name: TabName) => void,
  active: string,
): JSX.Element {
  const className =
    active == name
      ? clsx(style.toolbarTabItem, style.toolbarTabItemActive)
      : style.toolbarTabItem
  return (
    <li className={className} onClick={handleClick.bind(null, name)}>
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
  const [active, setActive] = useState<TabName>('status')

  function renderComp() {
    switch (active) {
      case 'db':
        return <LocalDBTab dbName={dbName} api={api} />
      case 'sql':
        return <SQLTab dbName={dbName} api={api} />
      case 'shapes':
        return <ShapesTab dbName={dbName} api={api} />
      default:
        return <StatusTab dbName={dbName} api={api} />
    }
  }

  return (
    <div className={style.toolbarTabs}>
      <ul className={style.toolbarTabItems}>
        {TabItem('Connection', 'status', setActive, active)}
        {TabItem('Local DB', 'db', setActive, active)}
        {TabItem('Shapes', 'shapes', setActive, active)}
        {TabItem('Shell', 'sql', setActive, active)}
      </ul>
      <div className={style.toolbarTabContent}>{renderComp()}</div>
    </div>
  )
}
