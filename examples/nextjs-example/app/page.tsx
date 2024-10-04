"use client"

import { v4 as uuidv4 } from "uuid"
import { useOptimistic } from "react"
import { useShape, getShapeStream } from "@electric-sql/react"
import "./Example.css"
import { matchStream } from "./match-stream"

const itemShape = () => {
  if (typeof window !== `undefined`) {
    return {
      url: new URL(`/shape-proxy`, window?.location.origin).href,
      table: `items`,
    }
  } else {
    return {
      url: new URL(`https://not-sure-how-this-works.com/shape-proxy`).href,
      table: `items`,
    }
  }
}

type Item = { id: string }

async function createItem(newId: string) {
  const itemsStream = getShapeStream<Item>(itemShape())

  // Match the insert
  const findUpdatePromise = matchStream({
    stream: itemsStream,
    operations: [`insert`],
    matchFn: ({ message }) => message.value.id === newId,
  })

  // Generate new UUID and post to backend
  const fetchPromise = fetch(`/api/items`, {
    method: `POST`,
    body: JSON.stringify({ uuid: newId }),
  })

  return await Promise.all([findUpdatePromise, fetchPromise])
}

async function clearItems() {
  const itemsStream = getShapeStream<Item>(itemShape())
  // Match the delete
  const findUpdatePromise = matchStream({
    stream: itemsStream,
    operations: [`delete`],
    // First delete will match
    matchFn: () => true,
  })
  // Post to backend to delete everything
  const fetchPromise = fetch(`/api/items`, {
    method: `DELETE`,
  })

  return await Promise.all([findUpdatePromise, fetchPromise])
}

export default function Home() {
  const { data: items } = useShape<Item>(itemShape())
  const [optimisticItems, updateOptimisticItems] = useOptimistic<
    Item[],
    { newId?: string; isClear?: boolean }
  >(items, (state, { newId, isClear }) => {
    if (isClear) {
      return []
    }

    if (newId) {
      // Merge data from shape & optimistic data from fetchers. This removes
      // possible duplicates as there's a potential race condition where
      // useShape updates from the stream slightly before the action has finished.
      const itemsMap = new Map()
      state.concat([{ id: newId }]).forEach((item) => {
        itemsMap.set(item.id, { ...itemsMap.get(item.id), ...item })
      })
      return Array.from(itemsMap.values())
    }

    return []
  })

  return (
    <div>
      <form
        action={async (formData: FormData) => {
          const intent = formData.get(`intent`)
          const newId = formData.get(`new-id`) as string
          if (intent === `add`) {
            updateOptimisticItems({ newId })
            await createItem(newId)
          } else if (intent === `clear`) {
            updateOptimisticItems({ isClear: true })
            await clearItems()
          }
        }}
      >
        <input type="hidden" name="new-id" value={uuidv4()} />
        <button type="submit" className="button" name="intent" value="add">
          Add
        </button>
        <button type="submit" className="button" name="intent" value="clear">
          Clear
        </button>
      </form>
      {optimisticItems.map((item: Item, index: number) => (
        <p key={index} className="item">
          <code>{item.id}</code>
        </p>
      ))}
    </div>
  )
}
