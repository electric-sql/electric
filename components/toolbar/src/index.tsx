import { render, type JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/material.css'
import 'codemirror/mode/sql/sql'
import style from './index.module.css'
import clsx from 'clsx'

import logo from './logo.svg'

import ToolbarTabs from './tabs'
import { ToolbarInterface } from './api/interface'
import { Toolbar } from './api/toolbar'
import { ElectricClient } from 'electric-sql/client/model'

import { Registry, GlobalRegistry } from 'electric-sql/satellite'

export type ToolbarProps = {
  api: ToolbarInterface
}

function ElectricToolbar({ api }: ToolbarProps) {
  const [hidden, setHidden] = useState(true)
  const [dbNames, setDbNames] = useState<Array<string>>([])
  const [dbName, setDbName] = useState('')

  useEffect(() => {
    const names = api.getSatelliteNames()
    setDbNames(names)
    if (names.length > 0) {
      setDbName(names[0])
    }
  }, [])

  function handleClick() {
    setHidden(!hidden)
  }

  function handleSelect(e: JSX.TargetedEvent<HTMLSelectElement, Event>) {
    setDbName((e.target as HTMLSelectElement).value)
  }

  return (
    <div className={clsx(style.toolbar, hidden && style.toolbarHidden)}>
      <header
        className={clsx(
          style.toolbarHeader,
          hidden && style.toolbarHeaderHidden,
        )}
      >
        <img src={logo} className={style.toolbarLogo} alt="logo" />
        <span className={style.navText}>ElectricSQL Debug Tools</span>
        <button onClick={handleClick}>{hidden ? 'SHOW' : 'HIDE'}</button>
        {!hidden && (
          <select onInput={handleSelect}>
            {dbNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </header>
      {!hidden && <ToolbarTabs dbName={dbName} api={api} />}
    </div>
  )
}

export function clientApi(registry: GlobalRegistry | Registry) {
  return new Toolbar(registry)
}

export function addToolbar(electric: ElectricClient<any>) {
  const toolbarApi = clientApi(electric.registry)
  const toolbarDiv = document.createElement('div')
  toolbarDiv.setAttribute('class', style.electricToolbar)
  document.body.appendChild(toolbarDiv)
  render(<ElectricToolbar api={toolbarApi} />, toolbarDiv)
}
