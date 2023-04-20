import { GeneratorOptions } from '@prisma/generator-helper'
import { z } from 'zod'

const providerSchema = z.string()

export const getPrismaClientProvider = (options: GeneratorOptions) => {
  const provider = providerSchema.parse(options.datasources[0].provider)
  if (provider === 'mongodb') {
    return {
      provider,
      isMongoDb: 'true',
    }
  }
  return { provider, isMongoDb: 'false' }
}
