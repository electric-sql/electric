import base64 from 'base64-js'
import React, { useEffect, useState } from 'react'
import { useShape } from '@electric-sql/react'
import './Example.css'

type Item = {
  id: string
  title: string
}

type EncryptedItem = {
  id: string
  ciphertext: string
  iv: string
}

const API_URL = import.meta.env.API_URL || 'http://localhost:3001'

// For this example, we hardcode a deterministic key that works across page loads.
// In a real app, you would implement a key management strategy. Electric is great
// at syncing keys between users :)
const rawKey = new Uint8Array(16)
const key = await crypto.subtle.importKey(
  'raw',
  rawKey as BufferSource,
  'AES-GCM',
  true,
  ['encrypt', 'decrypt']
)

/*
 * Encrypt an `Item` into an `EncryptedItem`.
 */
async function encrypt(item: Item): Promise<EncryptedItem> {
  const { id, title } = item

  const enc = new TextEncoder()
  const encoded = enc.encode(title)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    {
      iv: iv as BufferSource,
      name: 'AES-GCM',
    },
    key,
    encoded as BufferSource
  )

  const ciphertext = base64.fromByteArray(new Uint8Array(encrypted))
  const iv_str = base64.fromByteArray(iv)

  return {
    id,
    ciphertext,
    iv: iv_str,
  }
}

/*
 * Decrypt an `EncryptedItem` to an `Item`.
 */
async function decrypt(item: EncryptedItem): Promise<Item> {
  const { id, ciphertext, iv: iv_str } = item

  const encrypted = base64.toByteArray(ciphertext)
  const iv = base64.toByteArray(iv_str)

  const decrypted = await crypto.subtle.decrypt(
    {
      iv: iv as BufferSource,
      name: 'AES-GCM',
    },
    key,
    encrypted as BufferSource
  )

  const dec = new TextDecoder()
  const title = dec.decode(decrypted)

  return {
    id,
    title,
  }
}

export const Example = () => {
  const [items, setItems] = useState<Item[]>()

  const { data } = useShape<EncryptedItem>({
    url: `${API_URL}/items`,
  })

  const rows = data !== undefined ? data : []

  // There are more efficient ways of updating state than always decrypting
  // all the items on any change but just to demonstate the decryption ...
  useEffect(() => {
    async function init() {
      const items = await Promise.all(
        rows.map(async (row) => await decrypt(row))
      )

      setItems(items)
    }

    init()
  }, [rows])

  /*
   * Handle adding an item by creating the item data, encrypting it
   * and sending it to the API
   */
  async function createItem(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get('title') as string

    const id = crypto.randomUUID()
    const item = {
      id,
      title,
    }

    const data = await encrypt(item)

    const url = `${API_URL}/items`
    const options = {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    }

    await fetch(url, options)

    form.reset()
  }

  if (items === undefined) {
    return <div>Loading...</div>
  }

  return (
    <div>
      <div>
        {items.map((item: Item, index: number) => (
          <p key={index} className="item">
            <code>{item.title}</code>
          </p>
        ))}
      </div>
      <form onSubmit={createItem}>
        <input
          type="text"
          name="title"
          placeholder="Type here &hellip;"
          required
        />
        <button type="submit">Add</button>
      </form>
    </div>
  )
}
