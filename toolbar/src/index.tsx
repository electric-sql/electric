import React, { useEffect } from 'react'
import './index.css'

import logo from './logo.svg'
import { useState } from 'react'
import ReactDOM from 'react-dom/client'

import ToolbarTabs from './tabs'
import { getApi, setApi } from './api'
import { ToolbarInterface } from './api/toolbar-interface'
import { ToolbarTypescript } from './api/toolbar-typescript'
import { GlobalRegistry } from 'electric-sql/satellite'

function ElectricToolbar() {
  const [hidden, setHidden] = useState(true)
  const [dbNames, setDbNames] = useState([''])
  const [dbName, setDbName] = useState('')

  useEffect(() => {
    let names = getApi().getSatelliteNames()
    setDbNames(names)
    setDbName(names[0])
  }, [])

  function handleClick() {
    setHidden(!hidden)
  }

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    setDbName(e.target.value)
  }

  if (hidden) {
    return (
      // <div id={'electric-toolbar'}>
      <div className="Toolbar Toolbar-hidden">
        <header className="Toolbar-header Toolbar-header-hidden">
          <img src={logo} className="Toolbar-logo" alt="logo" />
          <span className="nav-text">ElectricSQL Debug Tools</span>
          <button onClick={handleClick}>SHOW</button>
        </header>
      </div>
      // </div>
    )
  } else {
    return (
      // <div id={'electric-toolbar'}>
      <div className="Toolbar">
        <header className="Toolbar-header">
          <img src={logo} className="Toolbar-logo" alt="logo" />
          <span className="nav-text">ElectricSQL Debug Tools</span>
          <button onClick={handleClick}>HIDE</button>
          <select onInput={handleSelect}>
            {dbNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </header>
        <ToolbarTabs dbName={dbName} />
      </div>
      // </div>
    )
  }
}

export function TypescriptApi(globalRegistry: GlobalRegistry): ToolbarInterface {
  return new ToolbarTypescript(globalRegistry)
}

export default function AddToolbar(toolbarApi: ToolbarInterface) {
  setApi(toolbarApi)
  const toolbar_div = document.createElement('div')
  toolbar_div.setAttribute('id', 'electric-toolbar')
  toolbar_div.setAttribute('class', 'electric-toolbar')
  document.body.appendChild(toolbar_div)
  const toolbar_root = ReactDOM.createRoot(
    document.getElementById('electric-toolbar') as HTMLElement,
  )
  toolbar_root.render(<ElectricToolbar />)
}
