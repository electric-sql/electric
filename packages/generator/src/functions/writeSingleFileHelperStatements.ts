import {
  writeDecimalJsLike,
  writeDecimalJsLikeList,
  writeInputJsonValue,
  writeIsValidDecimalInput,
  writeJsonValue,
  writeNullableJsonValue,
  writeTransformJsonNull,
} from '.'
import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileHelperStatements: WriteStatements = (
  dmmf,
  fileWriter
) => {
  fileWriter.writer.blankLine()
  fileWriter.writeHeading('HELPER FUNCTIONS', 'FAT')
  fileWriter.writer.blankLine()

  // JSON
  // ------------------------------------------------------------

  if (dmmf.schema.hasJsonTypes) {
    fileWriter.writeHeading(`JSON`, 'SLIM')

    writeTransformJsonNull({ fileWriter, dmmf })
    writeJsonValue({ fileWriter, dmmf })
    writeNullableJsonValue({ fileWriter, dmmf })
    writeInputJsonValue({ fileWriter, dmmf })

    fileWriter.writer.newLine()
  }

  // DECIMAL
  // ------------------------------------------------------------

  if (dmmf.schema.hasDecimalTypes) {
    fileWriter.writeHeading(`DECIMAL`, 'SLIM')

    writeDecimalJsLike({ fileWriter, dmmf })
    writeDecimalJsLikeList({ fileWriter, dmmf })
    writeIsValidDecimalInput({ fileWriter, dmmf })

    fileWriter.writer.newLine()
  }
}
