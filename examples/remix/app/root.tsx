import "./style.css"
import "./App.css"
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react"
import { json } from "@remix-run/node"
import type { LoaderFunctionArgs } from "@remix-run/node"

export async function loader(_: LoaderFunctionArgs) {
  return json({
    PUBLIC_SERVER_URL: process.env.PUBLIC_SERVER_URL,
  })
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { PUBLIC_SERVER_URL } = useLoaderData<typeof loader>()
  
  return (
    <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <Meta />
          <Links />
          <script
            dangerouslySetInnerHTML={{
              __html: `window.ENV = ${JSON.stringify({ PUBLIC_SERVER_URL })}`,
            }}
          />
        </head>
        <body style={{ margin: 0, padding: 0 }}>
          {children}
          <ScrollRestoration />
          <Scripts />
        </body>
      </html>
    )
  }

export default function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src="/logo.svg" className="App-logo" alt="logo" />
        <Outlet />
      </header>
    </div>
  )
}
