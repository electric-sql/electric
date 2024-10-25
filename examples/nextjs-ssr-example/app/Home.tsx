"use client"

import { v4 as uuidv4 } from "uuid"
import {
  useShape,
  getShapeStream,
  SerializedShapeData,
} from "@electric-sql/react"
import "./Example.css"
import { matchStream } from "./match-stream"
import { Offset, ShapeStreamOptions } from "@electric-sql/client"
import { useOptimistic } from "react"

const ELECTRIC_URL = process.env.ELECTRIC_URL || "http://localhost:3000"

const parser = {
  timestamptz: (date: string) => new Date(date).getTime(),
}

const shapePosition: { shapeId?: string; offset?: Offset } = {
  shapeId: undefined,
  offset: `-1`,
}

const shapeOptions: () => ShapeStreamOptions = () => {
  if (typeof window !== `undefined`) {
    return {
      url: new URL(`/shape-proxy/items`, window?.location.origin).href,
    }
  } else {
    const controller = new AbortController()
    controller.abort()
    return {
      url: new URL(`/v1/items`, ELECTRIC_URL).href,
      signal: controller.signal,
    }
  }
}

const itemShape = () => ({ ...shapeOptions(), ...shapePosition })

const updateShapePosition = (offset: Offset, shapeId?: string) => {
  shapePosition.offset = offset
  shapePosition.shapeId = shapeId
}

type Item = { id: string; created_at: number }

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

export default function Home({
  shapes,
}: {
  shapes: { items: SerializedShapeData }
}) {
  const { shapeId, offset, data } = shapes.items
  updateShapePosition(offset, shapeId)

  const { data: items } = useShape({
    ...itemShape(),
    shapeData: new Map(Object.entries(data ?? new Map())),
    parser,
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
