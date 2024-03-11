import React from 'react'
import logo from './logo.svg'
import './App.css'
import './style.css'

import { ElectricPixelsApp } from './ElectricPixels'

export default function App() {
  return (
    <div className="App">
      <header>
        <h1>
          Welcome to your first{' '}
          <a href="https://electric-sql.com/" target="_blank">
            ElectricSQL
          </a>
          &nbsp;app
        </h1>
        <h2>
          Build reactive, realtime, local-first apps
          directly&nbsp;on&nbsp;Postgres.
        </h2>
      </header>
      <ElectricPixelsApp />
      <footer>
        <div>
          <a
            className="button button__primary"
            href="https://electric-sql.com/docs/quickstart"
            target="_blank"
          >
            Quickstart
          </a>
          <a
            className="button"
            href="https://electric-sql.com/docs"
            target="_blank"
          >
            Electric Docs
          </a>
          <a
            className="button"
            href="https://github.com/electric-sql/electric"
            target="_blank"
          >
            GitHub Repo
          </a>
          <a
            className="button"
            href="https://github.com/electric-sql/electric/examples/pixels"
            target="_blank"
          >
            Electric Pixels Code
          </a>
        </div>
        <div>
          <img
            src={logo}
            width="32"
            height="32"
            className="App-logo"
            alt="logo"
          />
        </div>
      </footer>
    </div>
  )
}
