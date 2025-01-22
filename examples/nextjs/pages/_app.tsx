import { AppProps } from "next/app"
import { ElectricProvider } from "@electric-sql/react"
import "@/app/style.css"
import "@/app/App.css"
import "@/app/Example.css"

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ElectricProvider>
      <div className="App">
        <header className="App-header">
          <img src="/logo.svg" className="App-logo" alt="logo" />
          <Component {...pageProps} />
        </header>
      </div>
    </ElectricProvider>
  )
}
