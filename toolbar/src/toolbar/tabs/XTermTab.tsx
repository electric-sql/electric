import React from 'react'
import { useEffect, useState } from 'react'
// import { XTerm } from 'xterm-for-react'
// import { Terminal } from 'xterm'
//import "xterm/css/xterm.css"

export default function XTermTab(dbName: string): JSX.Element {
  const [_status, _setStatus] = useState('')

  useEffect(() => {
    console.log(dbName)
  }, [])

  // return (
  //   <XTerm />
  // );

  return <div>SQL coming soon</div>
}
