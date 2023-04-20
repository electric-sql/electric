import { it, expect } from 'vitest'

import { getAllBoolCombinations } from '../getAllBoolCombinations'

it('should transform array', () => {
  const permutations = getAllBoolCombinations([
    { elem: 'a', isRequired: true },
    { elem: 'b', isRequired: true },
    { elem: 'c', isRequired: true },
  ])

  expect(permutations).toEqual([
    [
      { elem: 'a', isRequired: true },
      { elem: 'b', isRequired: true },
      { elem: 'c', isRequired: true },
    ],
    [
      { elem: 'a', isRequired: true },
      { elem: 'b', isRequired: true },
      { elem: 'c', isRequired: false },
    ],
    [
      { elem: 'a', isRequired: true },
      { elem: 'b', isRequired: false },
      { elem: 'c', isRequired: true },
    ],
    [
      { elem: 'a', isRequired: true },
      { elem: 'b', isRequired: false },
      { elem: 'c', isRequired: false },
    ],
    [
      { elem: 'a', isRequired: false },
      { elem: 'b', isRequired: true },
      { elem: 'c', isRequired: true },
    ],
    [
      { elem: 'a', isRequired: false },
      { elem: 'b', isRequired: true },
      { elem: 'c', isRequired: false },
    ],
    [
      { elem: 'a', isRequired: false },
      { elem: 'b', isRequired: false },
      { elem: 'c', isRequired: true },
    ],
    [
      { elem: 'a', isRequired: false },
      { elem: 'b', isRequired: false },
      { elem: 'c', isRequired: false },
    ],
  ])
})
