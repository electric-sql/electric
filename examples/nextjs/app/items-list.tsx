"use client"
import { useOptimistic, startTransition, useState, useCallback } from "react"
import {
  SerializedShapeData,
  getShapeStream,
  useShape,
} from "@electric-sql/react"
import { ItemsView } from "./items-view"
import { matchStream } from "./match-stream"
import { type Item } from "./types"
import { getClientShapeOptions } from "./items"

async function createItem(newId: string) {
  const shapeOptions = getClientShapeOptions()
  const itemsStream = getShapeStream<Item>(shapeOptions)

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
  const shapeOptions = getClientShapeOptions()
  const itemsStream = getShapeStream<Item>(shapeOptions)

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

export function ItemsList({
  initialShape,
}: {
  initialShape: SerializedShapeData<Item>
}) {
  const { data: items } = useShape({
    ...getClientShapeOptions(),
    initialShape,
  })

  const [optimisticItems, setOptimisticItems] = useState(items)

  const updateOptimisticItems = useCallback(
    ({ newId, isClear }: Partial<{ newId: string; isClear: boolean }>) =>
      setOptimisticItems((items) => {
        // If clearing, return empty array
        if (isClear) {
          return []
        }

        // Create a new array combining all sources
        const allItems = [...items, ...optimisticItems]
        if (newId) {
          const newItem = { id: newId, value: `Item ${newId.slice(0, 4)}` }
          allItems.push(newItem)
        }

        // Deduplicate by id, keeping the last occurrence of each id
        const uniqueItems = allItems.reduce(
          (acc, item) => {
            acc[item.id] = item
            return acc
          },
          {} as Record<string, Item>
        )

        return Object.values(uniqueItems)
      }),
    []
  )

  // Pages can't use useOptimistic hook, so I'm using useState for now
  // const [optimisticItems, updateOptimisticItems] = useOptimistic<
  //   Item[],
  //   { newId?: string; isClear?: boolean }
  // >(items, (state, { newId, isClear }) => {
  //   // If clearing, return empty array
  //   if (isClear) {
  //     return []
  //   }

  //   // Create a new array combining all sources
  //   const allItems = [...items, ...state]
  //   if (newId) {
  //     const newItem = { id: newId, value: `Item ${newId.slice(0, 4)}` }
  //     allItems.push(newItem)
  //   }

  //   // Deduplicate by id, keeping the last occurrence of each id
  //   const uniqueItems = allItems.reduce(
  //     (acc, item) => {
  //       acc[item.id] = item
  //       return acc
  //     },
  //     {} as Record<string, Item>
  //   )

  //   return Object.values(uniqueItems)
  // })

  const handleAdd = async () => {
    const id = crypto.randomUUID()
    startTransition(async () => {
      updateOptimisticItems({ newId: id })
      await createItem(id)
    })
  }

  const handleClear = async () => {
    startTransition(async () => {
      updateOptimisticItems({ isClear: true })
      await clearItems()
    })
  }

  return (
    <ItemsView
      items={optimisticItems}
      onAdd={handleAdd}
      onClear={handleClear}
    />
  )
}
