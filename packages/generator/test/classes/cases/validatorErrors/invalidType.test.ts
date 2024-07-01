import { it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../../src/classes/extendedDMMF'
import { loadDMMF } from '../../../testUtils/loadDMMF'

it('should throw if an invalid key is used', async () => {
  const [dmmf, datamodel] = await loadDMMF(`${__dirname}/invalidType.prisma`)
  expect(() => new ExtendedDMMF(dmmf, {}, datamodel)).toThrowError(
    "[@zod generator error]: 'asdf' is not a valid validator type. [Error Location]: Model: 'MyModel', Field: 'custom'."
  )
})
