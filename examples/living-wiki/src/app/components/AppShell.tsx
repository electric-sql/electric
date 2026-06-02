import type { ReactNode } from 'react'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="lw-page">
      <div className="lw-shell">{children}</div>
    </main>
  )
}
