import "./style.css"
import "./App.css"

export const metadata = {
  title: `Next.js Forms Example`,
  description: `Example application with forms and Postgres.`,
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
