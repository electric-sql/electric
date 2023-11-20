import React, { useState } from 'react'
import { UnControlled as CodeMirror } from 'react-codemirror2'
import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/material.css'
import 'codemirror/mode/sql/sql'
import { ToolbarTabsProps } from '../tabs'

import './mirror.css'

export default function SQLTab({ dbName, api }: ToolbarTabsProps): JSX.Element {
  const [code, setCode] = useState(
    'SELECT name FROM sqlite_schema\n' +
      "WHERE type='table'\n" +
      'ORDER BY name; ',
  )
  const [response, setResponse] = useState('')
  const [history, setHistory] = useState('')
  const [active, setActive] = useState('query')

  function submitSQL() {
    let cmd = code
    setHistory(history + code + '\n\n')
    api.queryDB(dbName, { sql: cmd }).then((rows) => {
      setResponse(JSON.stringify(rows, null, 4))
    })
  }

  function clearResults() {
    setResponse('')
  }

  function clearHistory() {
    setHistory('')
  }

  function switchInput() {
    switch (active) {
      case 'query':
        return (
          <div className="mirror-column">
            <div className="mirror-header">
              <span className="header-span">query</span>
              <span
                className="header-span header-span-button"
                onClick={() => {
                  setActive('history')
                }}
              >
                history
              </span>
            </div>
            <div className="mirror-in">
              <CodeMirror
                value={code}
                onChange={(_editor, _data, value) => {
                  setCode(value)
                }}
                options={{
                  tabSize: 2,
                  mode: 'sql',
                  theme: 'material',
                  lineNumbers: true,
                }}
              />
            </div>
            <div className="mirror-ctls">
              <button id="submit-sql-button" onClick={submitSQL}>
                SUBMIT
              </button>
            </div>
          </div>
        )
      case 'history':
        return (
          <div className="mirror-column">
            <div className="mirror-header">
              <span
                className="header-span header-span-button"
                onClick={() => {
                  setActive('query')
                }}
              >
                query
              </span>
              <span className="header-span">history</span>
            </div>
            <div className="mirror-in">
              <CodeMirror
                value={history}
                onChange={(_editor, _data, _value) => {}}
                options={{
                  readOnly: true,
                  tabSize: 2,
                  mode: 'sql',
                  theme: 'material',
                  lineNumbers: false,
                }}
              />
            </div>
            <div className="mirror-ctls">
              <button id="submit-sql-button" onClick={clearHistory}>
                CLEAR
              </button>
            </div>
          </div>
        )
      default:
        return <div></div>
    }
  }

  return (
    <div className="mirror-wrapper">
      {switchInput()}
      <div className="mirror-column">
        <div className="mirror-header">results</div>
        <div className="mirror-in">
          <CodeMirror
            value={response}
            onChange={(_editor, _data, _value) => {}}
            options={{
              readOnly: true,
              tabSize: 2,
              mode: 'json',
              theme: 'material',
            }}
          />
        </div>
        <div className="mirror-ctls">
          <button onClick={clearResults}>CLEAR</button>
        </div>
      </div>
    </div>
  )
}
