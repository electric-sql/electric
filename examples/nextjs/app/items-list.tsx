"use client"

import { v4 as uuidv4 } from "uuid"
import { useOptimistic } from "react"
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
  const { data: rows } = useShape<Item>(shapeOptions)
  console.log({ rows })
  const [optimisticItems, addOptimisticItem] = useOptimistic(
    rows,
    (state, newItem: Item) => [...state, newItem]
  )

  const handleAdd = async () => {
    const id = uuidv4()
    const value = `Item ${id.slice(0, 4)}`
    addOptimisticItem({ id, value })
    await createItem(id)
  }

  const handleClear = async () => {
    await clearItems()
  }

  return (
    <ItemsView
      items={optimisticItems}
      onAdd={handleAdd}
      onClear={handleClear}
    />
  )
}
