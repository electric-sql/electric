import { FileWriter } from './classes'
import {
  writeArgTypeFiles,
  writeInputTypeFiles,
  writeModelFiles,
} from './functions'
import { CreateOptions } from './types'

export const generateMultipleFiles = ({ dmmf, path }: CreateOptions) => {
  // Create the index file
  new FileWriter().createFile(`${path}/index.ts`, ({ writeExport }) => {
    if (dmmf.generatorConfig.createModelTypes) {
      writeExport('*', './modelSchema')
    }

    writeExport('*', `./${dmmf.generatorConfig.inputTypePath}`)

    if (dmmf.generatorConfig.createInputTypes) {
      writeExport('*', `./${dmmf.generatorConfig.outputTypePath}`)
    }
  })

  writeModelFiles({ path, dmmf })
  writeInputTypeFiles({ path, dmmf })
  writeArgTypeFiles({ path, dmmf })
}
