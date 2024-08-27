import { useShape } from '@electric-sql/react'
import './Example.css'

type Item = { id: string }

const baseUrl = import.meta.env.ELECTRIC_URL ?? `http://localhost:3000`

export const Example = () => {
  const { data: items } = useShape({
    url: `${baseUrl}/v1/shape/items`,
  }) as unknown as { data: Item[] }

/*
  const addItem = async () => {
    console.log(`'addItem' is not implemented`)
  }

  const clearItems = async () => {
    console.log(`'clearItems' is not implemented`)
  }

      <div className="controls">
        <button className="button" onClick={addItem}>
          Add
        </button>
        <button className="button" onClick={clearItems}>
          Clear
        </button>
      </div>
      */
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
