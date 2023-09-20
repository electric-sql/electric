import React, { useState } from 'react'

import LocalDBTab from './tabs/LocalDBTab'
import DDLXTab from './tabs/DDLXTab'
import ShapesTab from './tabs/ShapesTab'
import XTermTab from './tabs/XTermTab'

let tabs: { [key: string]: (dbName: string) => JSX.Element } = {}

function TabItem(
  label: string,
  name: string,
  element: (dbName: string) => JSX.Element,
  handleClick: (e: React.MouseEvent<HTMLLIElement>, name: string) => void,
  active: string,
): JSX.Element {
  function click(e: React.MouseEvent<HTMLLIElement>) {
    handleClick(e, name)
  }

  tabs[name] = element

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

type ToolbarTabsProps = {
  dbName: string
}

export default function ToolbarTabs({ dbName }: ToolbarTabsProps): JSX.Element {
  const [active, setActive] = useState('db')
  function handleClick(_e: React.MouseEvent<HTMLLIElement>, name: string) {
    setActive(name)
  }

  return (
    <div className="Toolbar-tabs">
      <ul className="Toolbar-tab-items">
        {TabItem('Local DB', 'db', LocalDBTab, handleClick, active)}
        {TabItem('SQL', 'sql', XTermTab, handleClick, active)}
        {TabItem('Shapes', 'shapes', ShapesTab, handleClick, active)}
        {TabItem('DDLX', 'ddlx', DDLXTab, handleClick, active)}
      </ul>
      <div className="Toolbar-tab-content">{tabs[active](dbName)}</div>
    </div>
  )
}
