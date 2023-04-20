import { GeneratorOptions } from '@prisma/generator-helper'
import { z } from 'zod'

import { DirectoryHelper, ExtendedDMMF } from './classes'
import { generateMultipleFiles } from './generateMultipleFiles'
import { generateSingleFile } from './generateSingleFile'
import { skipGenerator } from './utils'

export interface GeneratorConfig {
  output: GeneratorOptions['generator']['output']
  config: GeneratorOptions['generator']['config']
  dmmf: GeneratorOptions['dmmf']
}

const outputSchema = z.object({
  fromEnvVar: z.string().nullable(),
  value: z.string({ required_error: 'No output path specified' }),
})

export const generator = async (config: GeneratorConfig) => {
  const output = outputSchema.parse(config.output)

  if (await skipGenerator()) {
    return console.log(
      '\x1b[33m',
      '!!!! Generation of zod schemas skipped! Generator is disabled in "zodGenConfig.js" !!!!',
      '\x1b[37m'
    )
  }

  // extend the DMMF with custom functionality - see "classes" folder
  const extendedDMMF = new ExtendedDMMF(config.dmmf, config.config)

  // If data is present in the output directory, delete it.
  DirectoryHelper.removeDir(output.value)

  // Create the output directory
  DirectoryHelper.createDir(output.value)

  // generate single or multiple files
  if (extendedDMMF.generatorConfig.useMultipleFiles) {
    return generateMultipleFiles({
      dmmf: extendedDMMF,
      path: output.value,
    })
  }

  return generateSingleFile({
    dmmf: extendedDMMF,
    path: output.value,
  })
}
