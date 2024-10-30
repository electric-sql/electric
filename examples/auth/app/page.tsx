"use client"

import { useSearchParams } from "next/navigation"
import { useShape } from "@electric-sql/react"
import { ShapeStreamOptions } from "@electric-sql/client"
import "./Example.css"

type User = {
  id: number
  name: string
  org_id: number
}

interface UserAccumulator {
  [key: number]: User[]
}

const usersShape = (): ShapeStreamOptions => {
  if (typeof window !== `undefined`) {
    const queryParams = new URLSearchParams(window.location.search)
    const org_id = queryParams.get(`org_id`)
    return {
      url: new URL(
        `/shape-proxy/users?org_id=${org_id}`,
        window.location.origin
      ).href,
      headers: {
        Authorization: org_id || ``,
      }
    }
  } else {
    return {
      url: new URL(`https://not-sure-how-this-works.com/shape-proxy/items`)
        .href,
    }
  }
}

export default function Home() {
  const searchParams = useSearchParams()
  const { data: users, isError, error } = useShape<User>(usersShape())

  const classFor = (org_id: string | null) => {
    const orgSearchParam = searchParams.get(`org_id`)
    return orgSearchParam === org_id ? `active-link` : `white-link`
  }

  return (
    <div>
      <nav>
        <ul>
          <li style={{ display: `inline` }}>
            <a
              href=""
              onClick={(e) => {
                e.preventDefault()
                window.location.search = ``
              }}
              className={classFor(null)}
            >
              Not logged in
            </a>
          </li>
          {` `}|{` `}
          <li style={{ display: `inline` }}>
            <a
              href="?user=1"
              onClick={(e) => {
                e.preventDefault()
                window.location.search = `?org_id=1`
              }}
              className={classFor(`1`)}
            >
              Alice — org 1
            </a>
          </li>
          {` `}|{` `}
          <li style={{ display: `inline` }}>
            <a
              href="?user=4"
              onClick={(e) => {
                e.preventDefault()
                window.location.search = `?org_id=2`
              }}
              className={classFor(`2`)}
            >
              David — org 2
            </a>
          </li>
          {` `}|{` `}
          <li style={{ display: `inline` }}>
            <a
              href="?user=admin"
              onClick={(e) => {
                e.preventDefault()
                window.location.search = `?org_id=admin`
              }}
              className={classFor(`admin`)}
            >
              Admin
            </a>
          </li>
        </ul>
      </nav>
      <h1>Users</h1>
      {isError ? (
        <div
          className="item"
          style={{ border: `3px solid red`, width: 400, fontSize: `21px` }}
        >
          {error.toString()}
        </div>
      ) : (
        Object.entries(
          users.reduce<UserAccumulator>((acc, user) => {
            const orgIdKey = user.org_id as number
            acc[orgIdKey] = acc[orgIdKey] || []
            acc[orgIdKey].push(user as unknown as User)
            return acc
          }, {} as UserAccumulator)
        ).map(([orgId, usersInOrg]) => (
          <div key={orgId}>
            <h2>Org ID: {orgId}</h2>
            {usersInOrg.map((user: User) => (
              <p key={user.id} className="item">
                <code>{user.name}</code>
              </p>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
