import React from "react"
import ReactDOM from "react-dom/client"

import App from "./App"
import "./style.css"

const root = document.getElementById("root")!

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
