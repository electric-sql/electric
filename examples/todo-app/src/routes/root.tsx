import { Outlet } from "react-router-dom"
import { ShapesProvider } from "@electric-sql/react"

export default function Root() {
  return (
    <>
      <ShapesProvider>
        <Outlet />
      </ShapesProvider>
    </>
  )
}
