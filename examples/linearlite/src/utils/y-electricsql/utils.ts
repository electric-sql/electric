import * as Y from 'yjs'

export function extractTextFromXmlFragment(xmlFragment: Y.XmlFragment) {
  const text = []
  for (const node of xmlFragment.createTreeWalker(
    (node) => node instanceof Y.Text
  )) {
    text.push(Y.Text.prototype.toString.call(node))
  }
  return text.join('')
}

export function generateRandomString(length: number) {
  const printableAscii =
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
  return Array.from({ length }, () => {
    return printableAscii.charAt(
      Math.floor(Math.random() * printableAscii.length)
    )
  }).join('')
}

// Below are temporary functions to convert between base64 and bytes
// once we have a way to store binary data in the database, we can remove these.

export async function base64ToBytes(base64string: string) {
  // convert the base64 string to a Blob:
  const blob = await fetch(
    `data:application/octet-stream;base64,${base64string}`
  ).then((r) => r.blob())
  // convert the Blob to a Uint8Array:
  return new Uint8Array(await blob.arrayBuffer())
}

export async function bytesToBase64(bytes: Uint8Array) {
  // From: https://stackoverflow.com/a/66046176
  // use a FileReader to generate a base64 data URI:
  const base64url: string = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(new Blob([bytes]))
  })
  // remove the `data:...;base64,` part from the start
  return base64url.slice(base64url.indexOf(',') + 1)
}
