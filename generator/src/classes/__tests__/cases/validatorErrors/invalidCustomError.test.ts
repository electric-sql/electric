import { it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'

it('should throw a custom error key is not valid', async () => {
  const dmmf = await loadDMMF(`${__dirname}/invalidCustomError.prisma`)
  expect(() => new ExtendedDMMF(dmmf, {})).toThrowError(
    "[@zod generator error]: Custom error key 'invalid_type_errrror' is not valid. Please check for typos! [Error Location]: Model: 'MyModel', Field: 'string'."
  )
})
