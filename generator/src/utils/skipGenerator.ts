import { z } from 'zod'

/////////////////////////////////////////////////
// SCHMEAS
/////////////////////////////////////////////////

const skipGeneratorSchema = z
  .string()
  .default('false')
  .transform((val) => val === 'true')
  .optional()

/////////////////////////////////////////////////
// FUNCTIONS
/////////////////////////////////////////////////

export const skipGenerator = async (): Promise<boolean> => {
  try {
    const importedConfig = await import(`${process.cwd()}/zodGenConfig.js`)

    return Boolean(
      skipGeneratorSchema.parse(importedConfig.default.skipGenerator)
    )
  } catch {
    return false
  }
}
