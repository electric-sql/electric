import logo from "./assets/logo.svg"
import "./App.css"
import "./style.css"

import { Example } from "./Example"
import { ShapesProvider } from "@electric-sql/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const queryClient = new QueryClient()

export default function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <QueryClientProvider client={queryClient}>
          <ShapesProvider>
            <Example />
          </ShapesProvider>
        </QueryClientProvider>
      </header>
    </div>
  )
}
