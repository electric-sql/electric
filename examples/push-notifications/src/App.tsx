import React from 'react'
import logo from './logo.svg'
import './App.css'
import './style.css'

import { Example } from './Example'

export default function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo.toString()} className="App-logo" alt="logo" />
        <Example />
      </header>
    </div>
  );
}
