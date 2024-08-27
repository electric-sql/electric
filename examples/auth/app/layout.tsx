import "./style.css"
import "./App.css"

export const metadata = {
  title: `Electric Auth Example`,
  description: `Example application showing how to do authentication and authorization with Electric.`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <div className="App">
          <header className="App-header">
            <img src="/logo.svg" className="App-logo" alt="logo" />
            {children}
          </header>
        </div>
      </body>
    </html>
  )
}
