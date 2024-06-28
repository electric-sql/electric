import { writeModelOrType } from './contentWriters'
import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileModelStatements: WriteStatements = (
  dmmf,
  fileWriter
) => {
  if (!dmmf.generatorConfig.createModelTypes) return

  fileWriter.writeHeading(`MODELS`, 'FAT')

  dmmf.datamodel.models.forEach((model) => {
    // fileWriter.writeHeading(`${model.formattedNames.upperCaseSpace}`, 'FAT');
    // fileWriter.writer.newLine();
    writeModelOrType({ fileWriter, dmmf }, model)
    fileWriter.writer.newLine()
  })
}
