import { it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'

it('should throw if an invalid key is used', async () => {
  const dmmf = await loadDMMF(`${__dirname}/invalidType.prisma`)
  expect(() => new ExtendedDMMF(dmmf, {})).toThrowError(
    "[@zod generator error]: 'asdf' is not a valid validator type. [Error Location]: Model: 'MyModel', Field: 'custom'."
  )
})
