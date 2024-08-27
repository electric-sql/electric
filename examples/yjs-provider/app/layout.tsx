export const metadata = {
  title: `Yjs <> Electric`,
  description: `Yjs synching with Electric`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
