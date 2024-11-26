import { useShape } from "@electric-sql/react"
import "./Example.css"

type Item = { id: string }

const baseUrl = import.meta.env.ELECTRIC_URL ?? `http://localhost:3000`

export const Example = () => {
  const { data: items } = useShape<Item>({
    url: `${baseUrl}/v1/shape`,
    table: `items`,
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
