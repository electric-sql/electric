import { Outlet, useSearchParams, useNavigate, NavLink } from "react-router-dom"

export default function Root() {
  return (
    <>
      <Outlet />
    </>
  )
}
