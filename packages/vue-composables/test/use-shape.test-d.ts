import { describe, expectTypeOf, it } from 'vitest'
import { useShape } from '../src/use-shape'

// Mock types for testing
interface Shape<T> {
  currentRows: T[]
  rows: Promise<T[]>
  error: Error | false
  lastSyncedAt(): number | undefined
}

interface ShapeStream<T> {
  options: any
  subscribe(callback: any): () => void
  isLoading(): boolean
  lastSyncedAt(): number | undefined
  isConnected(): boolean
}

interface TestRow {
  id: string
  title: string
  [key: string]: unknown
}

describe('useShape types', () => {
  it('should return the correct types', () => {
    const result = useShape<TestRow>({
      url: 'https://example.com',
      params: {
        table: 'test-table',
      },
    })

    expectTypeOf(result.data).toMatchTypeOf<TestRow[]>()
    expectTypeOf(result.shape).toMatchTypeOf<Shape<TestRow>>()
    expectTypeOf(result.stream).toMatchTypeOf<ShapeStream<TestRow>>()
    expectTypeOf(result.isLoading).toMatchTypeOf<boolean>()
    expectTypeOf(result.lastSyncedAt).toMatchTypeOf<number | undefined>()
    expectTypeOf(result.error).toMatchTypeOf<false | Error>()
    expectTypeOf(result.isError).toMatchTypeOf<boolean>()
  })

  it('should infer types from shape options', () => {
    const options = {
      url: 'https://example.com',
      params: {
        table: 'test-table',
      },
    }

    const result = useShape(options)
    // Should default to any type if not specified
    expectTypeOf(result.data).toMatchTypeOf<any[]>()
    expectTypeOf(result.shape).toMatchTypeOf<Shape<any>>()
  })

  it('should accept custom fetchClient', () => {
    const result = useShape<TestRow>({
      url: 'https://example.com',
      params: {
        table: 'test-table',
      },
      fetchClient: (input, init) => {
        return fetch(input, init)
      },
    })

    expectTypeOf(result.data).toMatchTypeOf<TestRow[]>()
  })

  it('should allow controlling subscription', () => {
    // With subscription enabled (default)
    const result1 = useShape<TestRow>({
      url: 'https://example.com',
      params: {
        table: 'test-table',
      },
    })

    // With subscription disabled
    const result2 = useShape<TestRow>({
      url: 'https://example.com',
      params: {
        table: 'test-table',
      },
      subscribe: false,
    })

    expectTypeOf(result1.data).toMatchTypeOf<TestRow[]>()
    expectTypeOf(result2.data).toMatchTypeOf<TestRow[]>()
  })
})