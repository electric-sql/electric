import { describe, it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'

describe('testSimpleModelNoValidators', async () => {
  const dmmf = await loadDMMF(`${__dirname}/extendedDMMF.prisma`)

  it('should set default values in ExtendedDMMF class without config', async () => {
    const extendedDMMF = new ExtendedDMMF(dmmf, {})

    expect(extendedDMMF.generatorConfig.createInputTypes).toStrictEqual(true)
    expect(extendedDMMF.generatorConfig.addInputTypeValidation).toStrictEqual(
      true
    )
  })

  it('should set default values in ExtendedDMMF class with config', async () => {
    const extendedDMMFConfig = {
      useInstanceOfForDecimal: 'true',
      createInputTypes: 'false',
      addInputTypeValidation: 'false',
    }
    const extendedDMMF = new ExtendedDMMF(dmmf, extendedDMMFConfig)

    expect(extendedDMMF.generatorConfig.createInputTypes).toStrictEqual(false)
    expect(extendedDMMF.generatorConfig.addInputTypeValidation).toStrictEqual(
      false
    )
  })
})
