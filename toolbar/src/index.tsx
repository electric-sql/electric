import React, { useEffect } from 'react'
import './index.css'

import logo from './logo.svg'
import { useState } from 'react'
import ReactDOM from 'react-dom/client'

import ToolbarTabs from './tabs'
import { getApi, setApi } from './client/api'
import { ToolbarApiBase } from './client/api/api-base'
import { ToolbarApiDummy } from './client/api/api-dummy'
import { ToolbarApiTypescript } from './client/api/api-typescript'

import { GlobalRegistry } from 'electric-sql/satellite'

declare global {
  interface Window {
    toolbarApi: ToolbarApiBase
  }
}

export type { ToolbarApiBase } from './client/api/api-base'

export type ToolbarProps = {
  api: ToolbarApiBase
}

export class DebugToolbar extends React.Component<ToolbarProps> {

  private api: ToolbarApiBase

  constructor(props: ToolbarProps) {
    super(props);
    this.api = props.api

  }

  render() {
      return <div id="electric-toolbar"><ElectricToolbar api={this.api} /></div>
    }
}


function ElectricToolbar({ api }: ToolbarProps) {
  setApi(api)
  const [hidden, setHidden] = useState(true)
  const [dbNames, setDbNames] = useState(['mary', 'mungo', 'midge'])
  const [dbName, setDbName] = useState('mary')

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

export function TypescriptApi(globalRegistry: GlobalRegistry) {
  return new ToolbarApiTypescript(globalRegistry)
}

export function DummyApi() {
  return new ToolbarApiDummy()
}

export default function AddToolbar( api: ToolbarApiBase) {
  setApi(api)
  const toolbar_div = document.createElement('div')
  toolbar_div.setAttribute('id', 'electric-toolbar')
  toolbar_div.setAttribute('class', 'electric-toolbar')
  document.body.appendChild(toolbar_div)
  const toolbar_root = ReactDOM.createRoot(
    document.getElementById('electric-toolbar') as HTMLElement,
  )
  toolbar_root.render(<ElectricToolbar api={api}/>)
}
