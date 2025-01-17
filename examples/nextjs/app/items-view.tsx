import { type Item } from "./types"

interface ItemsViewProps {
  items: Item[]
  onAdd?: () => void
  onClear?: () => void
}

export function ItemsView({ items, onAdd, onClear }: ItemsViewProps) {
  return (
    <div className="container">
      <div className="buttons">
        {onAdd && (
          <button onClick={onAdd} className="button">
            Add
          </button>
        )}
        {onClear && (
          <button onClick={onClear} className="button">
            Clear
          </button>
        )}
      </div>
      <br />
      <div className="items">
        {items.map((item) => (
          <p key={item.id} className="item">
            {item.id}
          </p>
        ))}
      </div>
    </div>
  )
}
