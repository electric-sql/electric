import { getShapeStream, useShape } from "@electric-sql/react"
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query"
import { matchStream } from "./match-stream"
import { v4 as uuidv4 } from "uuid"
import "./Example.css"

type Item = { id: string }

const baseUrl = import.meta.env.ELECTRIC_URL ?? `http://localhost:3000`
const baseApiUrl = `http://localhost:3001`

const itemShape = () => ({
  url: new URL(`/v1/shape/items`, baseUrl).href,
})

async function createItem(newId: string) {
  const itemsStream = getShapeStream(itemShape())

  // Match the insert
  const findUpdatePromise = matchStream({
    stream: itemsStream,
    operations: [`insert`],
    matchFn: ({ message }) => message.value.id === newId,
  })

  // Insert item
  const fetchPromise = fetch(`${baseApiUrl}/items`, {
    method: "POST",
    body: JSON.stringify({ id: newId }),
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

  // Delete all items
  const fetchPromise = fetch(`${baseApiUrl}/items`, { method: "DELETE" })

  return await Promise.all([findUpdatePromise, fetchPromise])
}

export const Example = () => {
  const queryClient = useQueryClient()

  const { data: items } = useShape(itemShape()) as unknown as { data: Item[] }
  const submissions = useMutationState({
    filters: { status: "pending" },
    select: (mutation) => mutation.state.context as Item,
  })

  const { mutateAsync: addItemMut } = useMutation({
    mutationFn: (newId: string) => createItem(newId),
    onMutate: (id) => {
      const optimisticItem: Item = { id }
      return optimisticItem
    },
  })

  const { mutateAsync: clearItemsMut, isPending: isClearing } = useMutation({
    mutationFn: () => clearItems(),
    onMutate: () => queryClient.getMutationCache().clear(),
  })

  // Merge data from shape & optimistic data from fetchers. This removes
  // possible duplicates as there's a potential race condition where
  // useShape updates from the stream slightly before the action has finished.
  const itemsMap = new Map()
  items.concat(submissions).forEach((item) => {
    itemsMap.set(item.id, { ...itemsMap.get(item.id), ...item })
  })

  return (
    <div>
      <div>
        <button
          type="submit"
          className="button"
          onClick={() => addItemMut(uuidv4())}
        >
          Add
        </button>
        <button
          type="submit"
          className="button"
          onClick={() => clearItemsMut()}
        >
          Clear
        </button>
      </div>
      {isClearing
        ? ``
        : [...itemsMap.values()].map((item: Item, index: number) => (
            <p key={index} className="item">
              <code>{item.id}</code>
            </p>
          ))}
    </div>
  )
}
