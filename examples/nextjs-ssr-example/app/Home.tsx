"use client"

import { v4 as uuidv4 } from "uuid"
import { useShape, getShapeStream } from "@electric-sql/react"
import "./Example.css"
import { matchStream } from "./match-stream"
import { Row, ShapeStreamOptions } from "@electric-sql/client"
import { useOptimistic } from "react"
import { getProxiedOptions, getUrl } from "./utils"

const parser = {
  timestamptz: (date: string) => new Date(date).getTime(),
}

type Item = { id: string; created_at: number }

const options: Partial<ShapeStreamOptions> = {
  table: `items`,
  parser,
}

async function createItem(newId: string) {
  const itemsStream = getShapeStream<Row>(getProxiedOptions(options))

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
  const itemsStream = getShapeStream<Row>(getProxiedOptions(options))

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
  const { data: items } = useShape(getProxiedOptions(options)) as unknown as {
    data: Item[]
  }

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
      state
        .concat([{ id: newId, created_at: new Date().getTime() }])
        .forEach((item) => {
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
      {optimisticItems
        .sort((a, b) => a.created_at - b.created_at)
        .map((item: Item, index: number) => (
          <p key={index} className="item">
            <code>{item.id}</code>
          </p>
        ))}
    </div>
  )
}
