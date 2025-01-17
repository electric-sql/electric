import { type Item } from "./types"

interface ItemsViewProps {
  items: Item[]
  onAdd?: () => void
  onClear?: () => void
}

export function ItemsView({ items, onAdd, onClear }: ItemsViewProps) {
  console.log({ items })
  return (
    <div className="container">
      <div className="items">
        {items.map((item) => (
          <div key={item.id} className="item">
            {item.id}
          </div>
        ))}
      </div>
      <div className="buttons">
        {onAdd && <button onClick={onAdd}>Add Item</button>}
        {onClear && <button onClick={onClear}>Clear Items</button>}
      </div>
    </div>
  )
}
