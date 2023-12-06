import { writeOutputObjectType } from './contentWriters'
import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileArgTypeStatements: WriteStatements = (
  dmmf,
  fileWriter
) => {
  if (!dmmf.generatorConfig.createInputTypes) return

  fileWriter.writer.blankLine()

  fileWriter.writeHeading(`ARGS`, 'FAT')

  const types = dmmf.schema.outputObjectTypes
  types.argTypes.forEach((outputType) => {
    outputType.prismaActionFields.forEach((field) => {
      writeOutputObjectType({ dmmf, fileWriter }, field)
    })
  })
}
