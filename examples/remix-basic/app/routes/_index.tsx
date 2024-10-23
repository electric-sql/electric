import { useShape, preloadShape, getShapeStream } from "@electric-sql/react"
import { useFetchers, Form } from "@remix-run/react"
import { v4 as uuidv4 } from "uuid"
import type { ClientActionFunctionArgs } from "@remix-run/react"
import "../Example.css"
import { matchStream } from "../match-stream"

const itemShape = () => {
  return {
    url: new URL(`/shape-proxy`, window.location.origin).href,
    table: `items`,
  }
}

type Item = { id: string }

export const clientLoader = async () => {
  return await preloadShape(itemShape())
}

export const clientAction = async ({ request }: ClientActionFunctionArgs) => {
  const body = await request.formData()

  const itemsStream = getShapeStream<Item>(itemShape())

  if (body.get(`intent`) === `add`) {
    // Match the insert
    const findUpdatePromise = matchStream({
      stream: itemsStream,
      operations: [`insert`],
      matchFn: ({ message }) => message.value.id === body.get(`new-id`),
    })

    // Generate new UUID and post to backend
    const fetchPromise = fetch(`/api/items`, {
      method: `POST`,
      body: JSON.stringify({ uuid: body.get(`new-id`) }),
    })

    return await Promise.all([findUpdatePromise, fetchPromise])
  } else if (body.get(`intent`) === `clear`) {
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
}

export default function Example() {
  const { data: items } = useShape<Item>(itemShape())

  const submissions = useFetchers()
    .filter((fetcher) => fetcher.formData?.get(`intent`) === `add`)
    .map((fetcher) => {
      return { id: fetcher.formData?.get(`new-id`) } as Item
    })

  const isClearing = useFetchers().some(
    (fetcher) => fetcher.formData?.get(`intent`) === `clear`
  )

  // Merge data from shape & optimistic data from fetchers. This removes
  // possible duplicates as there's a potential race condition where
  // useShape updates from the stream slightly before the action has finished.
  const itemsMap = new Map()
  items.concat(submissions).forEach((item) => {
    itemsMap.set(item.id, { ...itemsMap.get(item.id), ...item })
  })
  return (
    <div>
      <Form navigate={false} method="POST" className="controls">
        <input type="hidden" name="new-id" value={uuidv4()} />
        <button className="button" name="intent" value="add">
          Add
        </button>
        <button className="button" name="intent" value="clear">
          Clear
        </button>
      </Form>
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

export function HydrateFallback() {
  return ``
}
