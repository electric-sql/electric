import { it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'

it('should throw if a validator text is used', async () => {
  const dmmf = await loadDMMF(`${__dirname}/invalidValidatorText.prisma`)
  expect(() => new ExtendedDMMF(dmmf, {})).toThrowError(
    "[@zod generator error]: Could not match validator 'max' with validatorPattern '.max(5, { muasssage: \"Custom message.\"})'. Please check for typos! [Error Location]: Model: 'MyModel', Field: 'date'."
  )
})
