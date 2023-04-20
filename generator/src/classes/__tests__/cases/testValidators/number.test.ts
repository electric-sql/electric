import { describe, it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'
describe('test number validators', async () => {
  const dmmf = await loadDMMF(`${__dirname}/number.prisma`)
  const extendedDMMF = new ExtendedDMMF(dmmf, {})

  describe('test validators', () => {
    const fields = {
      id: extendedDMMF.datamodel.models[0].fields[0],
      gt: extendedDMMF.datamodel.models[0].fields[1],
      gte: extendedDMMF.datamodel.models[0].fields[2],
      lt: extendedDMMF.datamodel.models[0].fields[3],
      lte: extendedDMMF.datamodel.models[0].fields[4],
      int: extendedDMMF.datamodel.models[0].fields[5],
      positive: extendedDMMF.datamodel.models[0].fields[6],
      nonnegative: extendedDMMF.datamodel.models[0].fields[7],
      negative: extendedDMMF.datamodel.models[0].fields[8],
      nonpositive: extendedDMMF.datamodel.models[0].fields[9],
      multipleOf: extendedDMMF.datamodel.models[0].fields[10],
      finite: extendedDMMF.datamodel.models[0].fields[11],
      chained: extendedDMMF.datamodel.models[0].fields[12],
    }

    it(`should add gt validator for field "${fields.gt.name}"`, () => {
      expect(fields.gt.zodValidatorString).toBe('.gt(5)')
    })

    it(`should add gte validator for field "${fields.gte.name}"`, () => {
      expect(fields.gte.zodValidatorString).toBe('.gte(5)')
    })

    it(`should add lt validator for field "${fields.lt.name}"`, () => {
      expect(fields.lt.zodValidatorString).toBe('.lt(5)')
    })

    it(`should add lte validator for field "${fields.lte.name}"`, () => {
      expect(fields.lte.zodValidatorString).toBe('.lte(5)')
    })

    it(`should add int validator for field "${fields.int.name}"`, () => {
      expect(fields.int.zodValidatorString).toBe('.int()')
    })

    it(`should add positive validator for field "${fields.positive.name}"`, () => {
      expect(fields.positive.zodValidatorString).toBe('.positive()')
    })

    it(`should add nonnegative validator for field "${fields.nonnegative.name}"`, () => {
      expect(fields.nonnegative.zodValidatorString).toBe('.nonnegative()')
    })

    it(`should add negative validator for field "${fields.negative.name}"`, () => {
      expect(fields.negative.zodValidatorString).toBe('.negative()')
    })

    it(`should add nonpositive validator for field "${fields.nonpositive.name}"`, () => {
      expect(fields.nonpositive.zodValidatorString).toBe('.nonpositive()')
    })

    it(`should add multipleOf validator for field "${fields.multipleOf.name}"`, () => {
      expect(fields.multipleOf.zodValidatorString).toBe('.multipleOf(5)')
    })

    it(`should add finite validator for field "${fields.finite.name}"`, () => {
      expect(fields.finite.zodValidatorString).toBe('.finite()')
    })

    it(`should add chained validators for field "${fields.chained.name}"`, () => {
      expect(fields.chained.zodValidatorString).toBe('.gt(5).lt(10)')
    })
  })

  describe('test validators with message', () => {
    const fields = {
      id: extendedDMMF.datamodel.models[1].fields[0],
      gt: extendedDMMF.datamodel.models[1].fields[1],
      gte: extendedDMMF.datamodel.models[1].fields[2],
      lt: extendedDMMF.datamodel.models[1].fields[3],
      lte: extendedDMMF.datamodel.models[1].fields[4],
      int: extendedDMMF.datamodel.models[1].fields[5],
      positive: extendedDMMF.datamodel.models[1].fields[6],
      nonnegative: extendedDMMF.datamodel.models[1].fields[7],
      negative: extendedDMMF.datamodel.models[1].fields[8],
      nonpositive: extendedDMMF.datamodel.models[1].fields[9],
      multipleOf: extendedDMMF.datamodel.models[1].fields[10],
      finite: extendedDMMF.datamodel.models[1].fields[11],
      chained: extendedDMMF.datamodel.models[1].fields[12],
    }

    it(`should add gt validator with message for field "${fields.gt.name}"`, () => {
      expect(fields.gt.zodValidatorString).toBe(
        '.gt(5, { message: "Must be greater than 5" })'
      )
    })

    it(`should add gte validator with message for field "${fields.gte.name}"`, () => {
      expect(fields.gte.zodValidatorString).toBe(
        '.gte(5, { message: "Must be greater than or equal to 5" })'
      )
    })

    it(`should add lt validator with message for field "${fields.lt.name}"`, () => {
      expect(fields.lt.zodValidatorString).toBe(
        '.lt(5, { message: "Must be less than 5" })'
      )
    })

    it(`should add lte validator with message for field "${fields.lte.name}"`, () => {
      expect(fields.lte.zodValidatorString).toBe(
        '.lte(5, { message: "Must be less than or equal to 5" })'
      )
    })

    it(`should add int validator with message for field "${fields.int.name}"`, () => {
      expect(fields.int.zodValidatorString).toBe(
        '.int({ message: "Must be an integer" })'
      )
    })

    it(`should add positive validator with message for field "${fields.positive.name}"`, () => {
      expect(fields.positive.zodValidatorString).toBe(
        '.positive({ message: "Must be positive" })'
      )
    })

    it(`should add nonnegative validator with message for field "${fields.nonnegative.name}"`, () => {
      expect(fields.nonnegative.zodValidatorString).toBe(
        '.nonnegative({ message: "Must be nonnegative" })'
      )
    })

    it(`should add negative validator with message for field "${fields.negative.name}"`, () => {
      expect(fields.negative.zodValidatorString).toBe(
        '.negative({ message: "Must be negative" })'
      )
    })

    it(`should add nonpositive validator with message for field "${fields.nonpositive.name}"`, () => {
      expect(fields.nonpositive.zodValidatorString).toBe(
        '.nonpositive({ message: "Must be nonpositive" })'
      )
    })

    it(`should add multipleOf validator with message for field "${fields.multipleOf.name}"`, () => {
      expect(fields.multipleOf.zodValidatorString).toBe(
        '.multipleOf(5, { message: "Must be a multiple of 5" })'
      )
    })

    it(`should add finite validator with message for field "${fields.finite.name}"`, () => {
      expect(fields.finite.zodValidatorString).toBe(
        '.finite({ message: "Must be finite" })'
      )
    })

    it(`should add chained validators with message for field "${fields.chained.name}"`, () => {
      expect(fields.chained.zodValidatorString).toBe(
        '.gt(5, { message: "Must be greater than 5" }).lt(10, { message: "Must be less than 10" })'
      )
    })
  })
})
