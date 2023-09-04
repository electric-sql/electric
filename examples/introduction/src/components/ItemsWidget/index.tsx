import clsx from 'clsx'
import React from 'react'
import { Item } from '../../electric'
import styles from './styles.module.css'

type Props = {
  add: () => Promise<void>,
  clear: () => Promise<void>,
  items: Item[] | undefined,
  inProgress: boolean,
  disableWhenInProgress: boolean,
  itemColor: string
}

const ItemsWidget = ({ add, clear, items, inProgress, disableWhenInProgress, itemColor }: Props) => {
  const itemsArray = items !== undefined ? [...items] : []
  const shouldDisable = inProgress && disableWhenInProgress

  return (
    <>
      <div className={styles.items}>
        {items.map((item: Item) => (
          <div key={ item.id }
              className={clsx(styles.item, styles[itemColor])}
          />
        ))}
      </div>
      <div>
        <button className="button button--secondary button--outline me-2"
            disabled={shouldDisable}
            onMouseDown={add}>
          Add
        </button>
        <button className="button button--secondary button--outline"
            disabled={shouldDisable}
            onMouseDown={clear}>
          Clear
        </button>
      </div>
    </>
  )
}

export default ItemsWidget
