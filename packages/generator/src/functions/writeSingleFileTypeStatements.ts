import { writeModelOrType } from './contentWriters'
import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileTypeStatements: WriteStatements = (
  dmmf,
  fileWriter
) => {
  if (
    !dmmf.generatorConfig.createModelTypes ||
    dmmf.generatorConfig.provider !== 'mongodb'
  )
    return

  fileWriter.writer.blankLine()

  fileWriter.writeHeading(`MONGODB TYPES`, 'FAT')

  dmmf.datamodel.types.forEach((type) => {
    fileWriter.writeHeading(`${type.formattedNames.upperCaseSpace}`, 'SLIM')
    fileWriter.writer.newLine()
    writeModelOrType({ fileWriter, dmmf }, type)
    fileWriter.writer.newLine()
  })
}
