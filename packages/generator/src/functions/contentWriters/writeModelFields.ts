import {
  writeJsDoc,
  writeBytes,
  writeCustomValidator,
  writeDecimal,
  writeEnum,
  writeJson,
  writeScalar,
} from '..'
import { ExtendedWriteFieldOptions } from '../../types'

export const writeModelFields = (options: ExtendedWriteFieldOptions) => {
  if (options.field.clearedDocumentation) {
    writeJsDoc(options.writer, options.field.clearedDocumentation)
  }

  if (options.field.zodCustomValidatorString) {
    return writeCustomValidator(options)
  }

  if (options.field.kind === 'enum') {
    return writeEnum(options)
  }

  if (options.field.isJsonType) {
    return writeJson(options)
  }

  if (options.field.isBytesType) {
    return writeBytes(options)
  }

  if (options.field.isDecimalType) {
    return writeDecimal(options)
  }

  return writeScalar(options)
}
