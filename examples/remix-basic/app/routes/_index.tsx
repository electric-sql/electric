import { useShape, preloadShape, getShapeStream } from "@electric-sql/react";
import { useFetchers, Form } from "@remix-run/react";
import { v4 as uuidv4 } from "uuid";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import "../Example.css";
import { matchStream } from "../match-stream";

const itemShape = () => {
  return {
    url: new URL(`/shape-proxy/items`, window.location.origin).href,
  };
};

export const clientLoader = async () => {
  return await preloadShape(itemShape());
};

export const clientAction = async ({ request }: ClientActionFunctionArgs) => {
  const body = await request.formData();

  const itemsStream = getShapeStream(itemShape());

  if (body.get(`intent`) === `add`) {
    // Match the insert
    const findUpdatePromise = matchStream({
      stream: itemsStream,
      operations: [`insert`],
      matchFn: ({ message }) => message.value.id === body.get(`new-id`),
    });

    // Generate new UUID and post to backend
    const fetchPromise = fetch(`/api/items`, {
      method: `POST`,
      body: JSON.stringify({ uuid: body.get(`new-id`) }),
    });

    return await Promise.all([findUpdatePromise, fetchPromise]);
  } else if (body.get(`intent`) === `clear`) {
    // Match the delete
    const findUpdatePromise = matchStream({
      stream: itemsStream,
      operations: [`delete`],
      // First delete will match
      matchFn: () => true,
    });
    // Post to backend to delete everything
    const fetchPromise = fetch(`/api/items`, {
      method: `DELETE`,
    });

    return await Promise.all([findUpdatePromise, fetchPromise]);
  }
};

type Item = { id: string };

export default function Example() {
  const { data: items } = useShape(itemShape()) as unknown as { data: Item[] };

  const submissions = useFetchers()
    .filter((fetcher) => fetcher.formData?.get(`intent`) === `add`)
    .map((fetcher) => {
      return { id: Object.fromEntries(fetcher.formData)[`new-id`] } as Item;
    });

  const isClearing = useFetchers().some(
    (fetcher) => fetcher.formData?.get(`intent`) === `clear`,
  );

  // Combine data from shape & optimistic data from fetchers. Combine while
  // removing duplicates as there's the possibility for a race condition where
  // useShape updates before the action has finished.
  const ids = new Set();
  const combined = items.concat(submissions).filter((item) => {
    if (ids.has(item.id)) {
      return false;
    } else {
      ids.add(item.id);
      return true;
    }
  });

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
        : combined.map((item: Item, index: number) => (
            <p key={index} className="item">
              <code>{item.id}</code>
            </p>
          ))}
    </div>
  );
}
