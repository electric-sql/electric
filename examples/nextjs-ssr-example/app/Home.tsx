"use client"

import { v4 as uuidv4 } from "uuid"
import { useShape, getShapeStream } from "@electric-sql/react"
import "./Example.css"
import { matchStream } from "./match-stream"
import { Offset, ShapeData } from "@electric-sql/client/*"
import { useEffect, useOptimistic, useState } from "react"
import { SSShape } from "./shape"

let offset: Offset | undefined
let shapeId: string | undefined = undefined

const itemShape = () => {
  if (typeof window !== `undefined`) {
    return {
      url: new URL(`/shape-proxy/items`, window?.location.origin).href,
      offset,
      shapeId,
    }
  } else {
    const controller = new AbortController()
    controller.abort()
    return {
      url: new URL(`https://not-sure-how-this-works.com/shape-proxy/items`)
        .href,
      signal: controller.signal,
    }
  }
}

type Item = { id: string }

async function createItem(newId: string) {
  const itemsStream = getShapeStream(itemShape())

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
  const itemsStream = getShapeStream(itemShape())
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

export default function Home({ shape }: { shape: SSShape }) {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  if (!offset) {
    offset = shape.offset
    shapeId = shape.shapeId ?? undefined
  }

  const shapeData = new Map(
    Object.entries(shape?.data ?? new Map())
  ) as ShapeData

  const { data: items } = useShape({
    ...itemShape(),
    shapeData,
  }) as unknown as {
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
      state.concat([{ id: newId }]).forEach((item) => {
        itemsMap.set(item.id, { ...itemsMap.get(item.id), ...item })
      })
      return Array.from(itemsMap.values())
    }

    return []
  })

  // Can't render entries on the server because order of
  // items is not guaranteed after de/serialization.
  if (!isClient) {
    return null
  }

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
