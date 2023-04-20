import { writeCustomEnum, writePrismaEnum } from '.'
import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileEnumStatements: WriteStatements = (
  dmmf,
  fileWriter
) => {
  fileWriter.writer.blankLine()

  fileWriter.writeHeading(`ENUMS`, 'FAT')

  dmmf.schema.enumTypes.prisma.forEach((enumData) => {
    writePrismaEnum({ dmmf, fileWriter }, enumData)
  })

  dmmf.datamodel.enums.forEach((enumData) => {
    writeCustomEnum({ fileWriter, dmmf }, enumData)
  })

  fileWriter.writer.newLine()
}
