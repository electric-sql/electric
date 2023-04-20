import { describe, it, expect } from 'vitest'

import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'
describe('test string validators', async () => {
  const dmmf = await loadDMMF(`${__dirname}/string.prisma`)
  const extendedDMMF = new ExtendedDMMF(dmmf, {})

  describe('test validators', () => {
    const fields = {
      id: extendedDMMF.datamodel.models[0].fields[0],
      customTypeError: extendedDMMF.datamodel.models[0].fields[1],
      min: extendedDMMF.datamodel.models[0].fields[2],
      max: extendedDMMF.datamodel.models[0].fields[3],
      length: extendedDMMF.datamodel.models[0].fields[4],
      email: extendedDMMF.datamodel.models[0].fields[5],
      url: extendedDMMF.datamodel.models[0].fields[6],
      uuid: extendedDMMF.datamodel.models[0].fields[7],
      cuid: extendedDMMF.datamodel.models[0].fields[8],
      regex: extendedDMMF.datamodel.models[0].fields[9],
      startsWith: extendedDMMF.datamodel.models[0].fields[10],
      endsWith: extendedDMMF.datamodel.models[0].fields[11],
      trim: extendedDMMF.datamodel.models[0].fields[12],
      datetime: extendedDMMF.datamodel.models[0].fields[13],
      chained: extendedDMMF.datamodel.models[0].fields[14],
    }

    it(`should add customTypeError to field "${fields.customTypeError.name}"`, () => {
      expect(fields.customTypeError.zodCustomErrors).toBe(
        '{ invalid_type_error: "my message", description: "my description" }'
      )
    })

    it(`should add min validator to field "${fields.min.name}"`, () => {
      expect(fields.min.zodValidatorString).toBe('.min(3)')
    })

    it(`should add max validator to field "${fields.max.name}"`, () => {
      expect(fields.max.zodValidatorString).toBe('.max(10)')
    })

    it(`should add length validator to field "${fields.length.name}"`, () => {
      expect(fields.length.zodValidatorString).toBe('.length(5)')
    })

    it(`should add email validator to field "${fields.email.name}"`, () => {
      expect(fields.email.zodValidatorString).toBe('.email()')
    })

    it(`should add url validator to field "${fields.url.name}"`, () => {
      expect(fields.url.zodValidatorString).toBe('.url()')
    })

    it(`should add uuid validator to field "${fields.uuid.name}"`, () => {
      expect(fields.uuid.zodValidatorString).toBe('.uuid()')
    })

    it(`should add cuid validator to field "${fields.cuid.name}"`, () => {
      expect(fields.cuid.zodValidatorString).toBe('.cuid()')
    })

    it(`should add regex validator to field "${fields.regex.name}"`, () => {
      expect(fields.regex.zodValidatorString).toBe('.regex(/^[a-z]+$/)')
    })

    it(`should add startsWith validator to field "${fields.startsWith.name}"`, () => {
      expect(fields.startsWith.zodValidatorString).toBe('.startsWith("abc")')
    })

    it(`should add endsWith validator to field "${fields.endsWith.name}"`, () => {
      expect(fields.endsWith.zodValidatorString).toBe('.endsWith("xyz")')
    })

    it(`should add trim validator to field "${fields.trim.name}"`, () => {
      expect(fields.trim.zodValidatorString).toBe('.trim()')
    })

    it(`should add datetime validator to field "${fields.datetime.name}"`, () => {
      expect(fields.datetime.zodValidatorString).toBe('.datetime()')
    })

    it(`should add chained validators to field "${fields.chained.name}"`, () => {
      expect(fields.chained.zodValidatorString).toBe(
        '.min(3).max(10).length(5)'
      )
    })
  })

  describe('test validators with custom error messages', () => {
    const fields = {
      id: extendedDMMF.datamodel.models[1].fields[0],
      customTypeError: extendedDMMF.datamodel.models[1].fields[1],
      min: extendedDMMF.datamodel.models[1].fields[2],
      max: extendedDMMF.datamodel.models[1].fields[3],
      length: extendedDMMF.datamodel.models[1].fields[4],
      email: extendedDMMF.datamodel.models[1].fields[5],
      url: extendedDMMF.datamodel.models[1].fields[6],
      uuid: extendedDMMF.datamodel.models[1].fields[7],
      cuid: extendedDMMF.datamodel.models[1].fields[8],
      regex: extendedDMMF.datamodel.models[1].fields[9],
      startsWith: extendedDMMF.datamodel.models[1].fields[10],
      endsWith: extendedDMMF.datamodel.models[1].fields[11],
      trim: extendedDMMF.datamodel.models[1].fields[12],
      datetime: extendedDMMF.datamodel.models[1].fields[13],
      chained: extendedDMMF.datamodel.models[1].fields[14],
    }

    it(`should add customTypeError to field "${fields.customTypeError.name}"`, () => {
      expect(fields.customTypeError.zodCustomErrors).toBe(
        '{ invalid_type_error: "my message", description: "my description" }'
      )
    })

    it(`should add custom error message to min validator for field "${fields.min.name}"`, () => {
      expect(fields.min.zodValidatorString).toBe(
        '.min(3, { message: "Must be 3 or more characters long" })'
      )
    })

    it(`should add custom error message to max validator for field "${fields.max.name}"`, () => {
      expect(fields.max.zodValidatorString).toBe(
        '.max(10, { message: "Must be 10 or fewer characters long" })'
      )
    })

    it(`should add custom error message to length validator for field "${fields.length.name}"`, () => {
      expect(fields.length.zodValidatorString).toBe(
        '.length(5, { message: "Must be exactly 5 characters long" })'
      )
    })

    it(`should add custom error message to email validator for field "${fields.email.name}"`, () => {
      expect(fields.email.zodValidatorString).toBe(
        '.email({ message: "Invalid email address" })'
      )
    })

    it(`should add custom error message to url validator for field "${fields.url.name}"`, () => {
      expect(fields.url.zodValidatorString).toBe(
        '.url({ message: "Invalid url" })'
      )
    })

    it(`should add custom error message to uuid validator for field "${fields.uuid.name}"`, () => {
      expect(fields.uuid.zodValidatorString).toBe(
        '.uuid({ message: "Invalid UUID" })'
      )
    })

    it(`should add custom error message to cuid validator for field "${fields.cuid.name}"`, () => {
      expect(fields.cuid.zodValidatorString).toBe(
        '.cuid({ message: "Invalid cuid" })'
      )
    })

    it(`should add custom error message to regex validator for field "${fields.regex.name}"`, () => {
      expect(fields.regex.zodValidatorString).toBe(
        '.regex(/^[a-z]+$/, { message: "Must be lowercase letters only" })'
      )
    })

    it(`should add custom error message to startsWith validator for field "${fields.startsWith.name}"`, () => {
      expect(fields.startsWith.zodValidatorString).toBe(
        '.startsWith("abc", { message: "Must start with abc" })'
      )
    })

    it(`should add custom error message to endsWith validator for field "${fields.endsWith.name}"`, () => {
      expect(fields.endsWith.zodValidatorString).toBe(
        '.endsWith("xyz", { message: "Must end with xyz" })'
      )
    })

    it(`should add custom error message to trim validator for field "${fields.trim.name}"`, () => {
      expect(fields.trim.zodValidatorString).toBe(
        '.trim({ message: "Must be trimmed" })'
      )
    })

    it(`should add custom error message to datetime validator for field "${fields.datetime.name}"`, () => {
      expect(fields.datetime.zodValidatorString).toBe(
        '.datetime({ message: "Invalid datetime! string Must be UTC." })'
      )
    })

    it(`should add custom error message to chained validators for field "${fields.chained.name}"`, () => {
      expect(fields.chained.zodValidatorString).toBe(
        '.min(3, { message: "Must be 3 or more characters long" }).max(10, { message: "Must be 10 or fewer characters long" }).length(5, { message: "Must be exactly 5 characters long" })'
      )
    })
  })
})
