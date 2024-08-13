import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react"
import { Flex } from "@radix-ui/themes"

import { Theme } from "@radix-ui/themes"
import "@fontsource/inter/latin.css"
import "@radix-ui/themes/styles.css"
import "../.cache/typography.css"

import { ShapesProvider } from "@electric-sql/react"

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
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
    <Theme>
      <ShapesProvider>
        <Flex p="3" style={{ margin: `0 auto`, maxWidth: 960 }}>
          <Outlet />
        </Flex>
      </ShapesProvider>
    </Theme>
  )
}
