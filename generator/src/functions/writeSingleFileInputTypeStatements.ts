import { writeInputObjectType } from './contentWriters'
import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileInputTypeStatements: WriteStatements = (
  dmmf,
  fileWriter
) => {
  if (!dmmf.generatorConfig.createInputTypes) return

  fileWriter.writer.blankLine()

  fileWriter.writeHeading(`INPUT TYPES`, 'FAT')

  dmmf.schema.inputObjectTypes.prisma.forEach((inputType) => {
    writeInputObjectType({ dmmf, fileWriter }, inputType)
    fileWriter.writer.newLine()
  })
}
