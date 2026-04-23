import { createHash } from 'node:crypto'

export const EMBEDDING_DIMENSIONS = 128

function tokenize(value: string): Array<string> {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ` `)
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

function hashToken(token: string): Buffer {
  return createHash(`sha256`).update(token).digest()
}

export function embedText(value: string): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS)
  const tokens = tokenize(value)

  for (const token of tokens) {
    const hash = hashToken(token)
    for (let index = 0; index < 4; index++) {
      const raw = hash.readUInt32BE(index * 4)
      const dimension = raw % EMBEDDING_DIMENSIONS
      const sign = (hash[index + 16]! & 1) === 0 ? 1 : -1
      vector[dimension]! += sign
    }
  }

  let norm = 0
  for (const value of vector) {
    norm += value * value
  }
  norm = Math.sqrt(norm)

  if (norm > 0) {
    for (let index = 0; index < vector.length; index++) {
      vector[index]! /= norm
    }
  }

  return vector
}

export function embeddingToSqlInput(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer.slice(0))
}
