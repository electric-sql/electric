import { useShape } from '@electric-sql/react'

import './Example.css'

type Item = { id: string }

const baseUrl = import.meta.env.ELECTRIC_URL ?? `http://localhost:3000`
//const { useShape } = reactHooks

export const Example = () => {
  const { data: items } = useShape({
    shape: { table: `items` },
    baseUrl,
  }) as unknown as { data: Item[] }

  const addItem = async () => {
    console.log(`'addItem' is not implemented`)
  }

  const clearItems = async () => {
    console.log(`'clearItems' is not implemented`)
  }

  return (
    <div>
      <div className="controls">
        <button className="button" onClick={addItem}>
          Add
        </button>
        <button className="button" onClick={clearItems}>
          Clear
        </button>
      </div>
      {items.map((item: Item, index: number) => (
        <p key={index} className="item">
          <code>{item.id}</code>
        </p>
      ))}
    </div>
  )
}
