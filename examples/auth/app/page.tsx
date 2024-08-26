"use client"

import { useShape, getShapeStream } from "@electric-sql/react"
import { ShapeStreamOptions } from "@electric-sql/client"
import "./Example.css"

interface User {
  id: number;
  name: string;
  org_id: number;
}

interface UserAccumulator {
  [key: number]: User[];
}

const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
  const queryParams = new URLSearchParams(window.location.search)
  const org_id = queryParams.get(`org_id`)
  const modifiedArgs = [...args]
  if (org_id) {
    const headers = new Headers((modifiedArgs[1] as RequestInit)?.headers || {})
    headers.set(`Authorization`, org_id)
    modifiedArgs[1] = { ...(modifiedArgs[1] as RequestInit), headers }
  }
  const response = await fetch(...(modifiedArgs as [RequestInfo, RequestInit?]))
  return response
}

const usersShape = (): ShapeStreamOptions => {
  if (typeof window !== `undefined`) {
    return {
      url: new URL(`/shape-proxy/users`, window.location.origin).href,
      fetchClient: fetchWrapper,
    }
  } else {
    return {
      url: new URL(`https://not-sure-how-this-works.com/shape-proxy/items`)
        .href,
    }
  }
}

export default function Home() {
  const { data: users, isError, error } = useShape(usersShape())

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
              className={
                window.location.search === `` ? `active-link` : `white-link`
              }
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
              className={
                window.location.search.includes(`org_id=1`)
                  ? `active-link`
                  : `white-link`
              }
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
              className={
                window.location.search.includes(`org_id=2`)
                  ? `active-link`
                  : `white-link`
              }
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
              className={
                window.location.search.includes(`admin`)
                  ? `active-link`
                  : `white-link`
              }
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
