import { type JSX } from 'preact'
import { useState } from 'preact/hooks'
import { Controlled as CodeMirrorControlled } from 'react-codemirror2'
import { ToolbarTabsProps } from '../tabs'
import clsx from 'clsx'
import style from './SQLTab.module.css'

export default function SQLTab({ dbName, api }: ToolbarTabsProps): JSX.Element {
  const [code, setCode] = useState(
    'SELECT name FROM sqlite_schema\n' +
      "WHERE type='table'\n" +
      'ORDER BY name;',
  )
  const [response, setResponse] = useState('')
  const [history, setHistory] = useState('')
  const [active, setActive] = useState('query')

  function submitSQL() {
    setHistory(history + code + '\n\n')
    api.queryDb(dbName, { sql: code }).then(
      (rows) => {
        setResponse(JSON.stringify(rows, null, 4))
      },
      (err) => {
        setResponse('Error: ' + err)
      },
    )
  }

  function clearHistory() {
    setHistory('')
  }

  function renderQuery() {
    return (
      <div className={style.mirrorColumn}>
        <div className={style.mirrorHeader}>
          <span className={style.headerSpan}>query</span>
          <span
            className={clsx(style.headerSpan, style.headerSpanButton)}
            onClick={setActive.bind(null, 'history')}
          >
            history
          </span>
        </div>
        <div className={style.mirrorIn}>
          <CodeMirrorControlled
            className={style.codeMirror}
            value={code}
            onBeforeChange={(_editor, _data, value) => {
              setCode(value)
            }}
            options={{
              tabSize: 4,
              mode: 'sql',
              theme: 'material',
              lineNumbers: true,
            }}
          />
        </div>
        <div className={style.mirrorCtls}>
          <button id="submit-sql-button" onClick={submitSQL}>
            SUBMIT
          </button>
        </div>
      </div>
    )
  }

  function renderHistory() {
    return (
      <div className={style.mirrorColumn}>
        <div className={style.mirrorHeader}>
          <span
            className={clsx(style.headerSpan, style.headerSpanButton)}
            onClick={setActive.bind(null, 'query')}
          >
            query
          </span>
          <span className={style.headerSpan}>history</span>
        </div>
        <div className={style.mirrorIn}>
          <CodeMirrorControlled
            className={style.codeMirror}
            value={history}
            onBeforeChange={(_editor, _data, _value) => {}}
            options={{
              readOnly: true,
              tabSize: 4,
              mode: 'sql',
              theme: 'material',
              lineNumbers: false,
            }}
          />
        </div>
        <div className={style.mirrorCtls}>
          <button id="submit-sql-button" onClick={clearHistory}>
            CLEAR
          </button>
        </div>
      </div>
    )
  }

  function switchInput() {
    switch (active) {
      case 'query':
        return renderQuery()
      case 'history':
        return renderHistory()
      default:
        return <div></div>
    }
  }

  return (
    <div className={style.mirrorWrapper}>
      {switchInput()}
      <div className={style.mirrorColumn}>
        <div className={style.mirrorHeader}>results</div>
        <div className={style.mirrorIn}>
          <CodeMirrorControlled
            className={style.codeMirror}
            value={response}
            onBeforeChange={(_editor, _data, _value) => {}}
            options={{
              readOnly: true,
              tabSize: 4,
              mode: 'json',
              theme: 'material',
            }}
          />
        </div>
        <div className={style.mirrorCtls}>
          <button onClick={setResponse.bind(null, '')}>CLEAR</button>
        </div>
      </div>
    </div>
  )
}
