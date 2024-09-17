import { useLiveQuery } from "@electric-sql/pglite-react"
import { listingsTableName } from "./table"

import "./Example.css"

type Item = { name: string }

export const Example = () => {
  const result = useLiveQuery<Item>(
    `SELECT * FROM ${listingsTableName} LIMIT 10;`,
    []
  )

  return (
    <div>
      {result?.rows.map((item: Item, index: number) => (
        <p key={index} className="item">
          <code>{item.name}</code>
        </p>
      ))}
    </div>
  )
}
