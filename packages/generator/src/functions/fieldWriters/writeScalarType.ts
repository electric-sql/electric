/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { WriteTypeFunction } from '../../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

/**
 * Checks if a type is a scalar type e.g. string, number, date.
 *
 * If yes, it writes the corresponding zod type - if no, it returns undefined.
 *
 * @param writer CodeBlockWriter
 * @param options WriteTypeFunction
 * @returns CodeBlockWriter | undefined
 */
export const writeScalarType: WriteTypeFunction = (
  writer,
  {
    inputType,
    isOptional,
    isNullable,
    writeComma = true,
    zodCustomErrors,
    zodValidatorString,
    zodCustomValidatorString,
    writeValidation = true,
  }
) => {
  const zodType = inputType.getZodScalarType()
  if (!zodType) return

  // The schemas for bigint and bigint arrays
  // accept both bigints and integers
  // but transform integers to bigint
  // We could also support arrays that mix both integers and bigints
  // by always using `bigIntSchema` and moving the `array()` call
  // to the end by using a conditional write as how it is done for the other types
  // But the Prisma typings do not allow this so we would have to modify the Prisma typings
  const bigIntSchema =
    'z.union([ z.bigint().gte(-9223372036854775808n).lte(9223372036854775807n), z.number().int().gte(Number.MIN_SAFE_INTEGER).lte(Number.MAX_SAFE_INTEGER).transform(BigInt) ])'
  const bigIntArraySchema =
    'z.union([ z.bigint().gte(-9223372036854775808n).lte(9223372036854775807n).array(), z.number().int().gte(Number.MIN_SAFE_INTEGER).lte(Number.MAX_SAFE_INTEGER).transform(BigInt).array() ])'

  if (zodCustomValidatorString) {
    if (zodType === 'date') {
      return writer
        .conditionalWrite(
          inputType.generatorConfig.addInputTypeValidation,
          zodCustomValidatorString
        )
        .conditionalWrite(
          !inputType.generatorConfig.addInputTypeValidation &&
            !inputType.generatorConfig.coerceDate,
          `z.${zodType}()`
        )
        .conditionalWrite(
          !inputType.generatorConfig.addInputTypeValidation &&
            inputType.generatorConfig.coerceDate,
          `z.coerce.${zodType}()`
        )
        .conditionalWrite(inputType.isList, `.array()`)
        .conditionalWrite(isOptional, `.optional()`)
        .conditionalWrite(isNullable, `.nullable()`)
        .conditionalWrite(writeComma, `,`)
    }

    if (zodType === 'bigint') {
      return writer
        .conditionalWrite(
          inputType.generatorConfig.addInputTypeValidation,
          zodCustomValidatorString
        )
        .conditionalWrite(
          inputType.generatorConfig.addInputTypeValidation && inputType.isList,
          `.array()`
        )
        .conditionalWrite(
          !inputType.generatorConfig.addInputTypeValidation &&
            !inputType.isList,
          bigIntSchema
        )
        .conditionalWrite(
          !inputType.generatorConfig.addInputTypeValidation && inputType.isList,
          bigIntArraySchema
        )
        .conditionalWrite(isOptional, `.optional()`)
        .conditionalWrite(isNullable, `.nullable()`)
        .conditionalWrite(writeComma, `,`)
    }

    // only writes the validator string if the user has not disabled input type validation
    return writer
      .conditionalWrite(
        inputType.generatorConfig.addInputTypeValidation,
        zodCustomValidatorString
      )
      .conditionalWrite(
        !inputType.generatorConfig.addInputTypeValidation,
        `z.${zodType}()`
      )
      .conditionalWrite(inputType.isList, `.array()`)
      .conditionalWrite(isOptional, `.optional()`)
      .conditionalWrite(isNullable, `.nullable()`)
      .conditionalWrite(writeComma, `,`)
  }

  if (zodType === 'date') {
    return writer
      .conditionalWrite(!inputType.generatorConfig.coerceDate, `z.${zodType}(`)
      .conditionalWrite(
        inputType.generatorConfig.coerceDate,
        `z.coerce.${zodType}(`
      )
      .conditionalWrite(writeValidation && !!zodCustomErrors, zodCustomErrors!)
      .write(`)`)
      .conditionalWrite(
        writeValidation && !!zodValidatorString,
        zodValidatorString!
      )
      .conditionalWrite(inputType.isList, `.array()`)
      .conditionalWrite(isOptional, `.optional()`)
      .conditionalWrite(isNullable, `.nullable()`)
      .conditionalWrite(writeComma, `,`)
  }

  if (zodType === 'bigint') {
    return writer
      .conditionalWrite(!inputType.isList, bigIntSchema)
      .conditionalWrite(inputType.isList, bigIntArraySchema)
      .conditionalWrite(
        writeValidation && !!zodValidatorString,
        zodValidatorString!
      )
      .conditionalWrite(isOptional, `.optional()`)
      .conditionalWrite(isNullable, `.nullable()`)
      .conditionalWrite(writeComma, `,`)
  }

  return writer
    .write(`z.${zodType}(`)
    .conditionalWrite(writeValidation && !!zodCustomErrors, zodCustomErrors!)
    .write(`)`)
    .conditionalWrite(
      writeValidation && !!zodValidatorString,
      zodValidatorString!
    )
    .conditionalWrite(inputType.isList, `.array()`)
    .conditionalWrite(isOptional, `.optional()`)
    .conditionalWrite(isNullable, `.nullable()`)
    .conditionalWrite(writeComma, `,`)
}
