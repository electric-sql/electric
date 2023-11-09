import test from 'ava'

import { chunkBy } from '../../src/util/arrays.js'

test('chunkBy: correctly chunks an array based on a predicate', (t) => {
  const source = ['a', 'b', '', 'aa', 'bb', 'a']

  const result = [...chunkBy(source, (x) => x.length)]

  t.deepEqual(result, [
    [1, ['a', 'b']],
    [0, ['']],
    [2, ['aa', 'bb']],
    [1, ['a']],
  ])
})

test('chunkBy: correctly chunks an array based on a false-ish predicate', (t) => {
  const source = ['a', 'b', '', 'bb', 'aa', 'a', 'b']

  const result = [...chunkBy(source, (x) => x.includes('a'))]

  t.deepEqual(result, [
    [true, ['a']],
    [false, ['b', '', 'bb']],
    [true, ['aa', 'a']],
    [false, ['b']],
  ])
})

test('chunkBy: returns an empty iterator on empty source', (t) => {
  const source: string[] = []

  const result = [...chunkBy(source, (x) => x.includes('a'))]

  t.deepEqual(result, [])
})

test('chunkBy: works on a single element', (t) => {
  const source: string[] = ['a']

  const result = [...chunkBy(source, () => undefined)]

  t.deepEqual(result, [[undefined, ['a']]])
})
