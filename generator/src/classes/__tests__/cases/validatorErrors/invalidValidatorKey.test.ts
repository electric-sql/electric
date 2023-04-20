import { it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'

it("should throw if the wrong validator key is used for a type that doesn't support it", async () => {
  const dmmf = await loadDMMF(`${__dirname}/invalidValidatorKey.prisma`)
  expect(() => new ExtendedDMMF(dmmf, {})).toThrowError(
    "[@zod generator error]: Validator 'asdf' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'MyModel', Field: 'custom'."
  )
})
