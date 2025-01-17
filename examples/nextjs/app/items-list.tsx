"use client"

import { v4 as uuidv4 } from "uuid"
import { useOptimistic, startTransition } from "react"
import { useShape, getShapeStream } from "@electric-sql/react"
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

export function ItemsList() {
  const shapeOptions = getClientShapeOptions()
  console.log(1)
  const { data: rows } = useShape<Item>(shapeOptions)
  const [optimisticItems, updateOptimisticItems] = useOptimistic<
    Item[],
    { newId?: string; isClear?: boolean }
  >(rows, (state, { newId, isClear }) => {
    // If clearing, return empty array
    if (isClear) {
      return []
    }

    // Create a new array combining all sources
    const allItems = [...rows, ...state]
    if (newId) {
      const newItem = { id: newId, value: `Item ${newId.slice(0, 4)}` }
      allItems.push(newItem)
    }

    // Deduplicate by id, keeping the last occurrence of each id
    const uniqueItems = allItems.reduce((acc, item) => {
      acc[item.id] = item
      return acc
    }, {} as Record<string, Item>)

    return Object.values(uniqueItems)
  })

  const handleAdd = async () => {
    const id = uuidv4()
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
