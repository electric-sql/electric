import { it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../../src/classes/extendedDMMF'
import { loadDMMF } from '../../../testUtils/loadDMMF'

it('should throw if a validator text is used', async () => {
  const [dmmf, datamodel] = await loadDMMF(
    `${__dirname}/invalidValidatorText.prisma`
  )
  expect(() => new ExtendedDMMF(dmmf, {}, datamodel)).toThrowError(
    "[@zod generator error]: Could not match validator 'max' with validatorPattern '.max(5, { muasssage: \"Custom message.\"})'. Please check for typos! [Error Location]: Model: 'MyModel', Field: 'date'."
  )
})
