import { generatorHandler } from '@prisma/generator-helper'

import { generator } from './generator'
import { getPrismaClientOutputPath, getPrismaClientProvider } from './utils'

generatorHandler({
  onManifest: () => {
    return {
      defaultOutput: './generated/zod',
      prettyName: 'Zod Prisma Types',
    }
  },
  onGenerate: async (generatorOptions) => {
    return generator({
      output: generatorOptions.generator.output,

      // Merge the generator config with the prisma client output path
      // The prisma client output path is automatically located
      config: {
        ...generatorOptions.generator.config,
        ...getPrismaClientOutputPath(generatorOptions),
        ...getPrismaClientProvider(generatorOptions),
      },
      dmmf: generatorOptions.dmmf,
    })
  },
})
