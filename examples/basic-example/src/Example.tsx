import { useShape } from "@electric-sql/react"
import "./Example.css"

type Item = { id: string }

const baseUrl = import.meta.env.VITE_ELECTRIC_URL ?? `http://localhost:3000`

export const Example = () => {
  const { data: items } = useShape<Item>({
    url: `${baseUrl}/v1/shape`,
    params: {
      table: `items`,
      token: import.meta.env.VITE_ELECTRIC_TOKEN,
      database_id: import.meta.env.VITE_ELECTRIC_DATABASE_ID,
    },
  })

  return (
    <div>
      {items.map((item: Item, index: number) => (
        <p key={index} className="item">
          <code>{item.id}</code>
        </p>
      ))}
    </div>
  )
}
