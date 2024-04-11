import { join } from 'path'
import { copyTemplateOverlayFiles } from './template-utils.js'
import templateConfig from '../template-config.js'
import { mkdir } from 'fs/promises'

const baseDir = new URL('.', import.meta.url).pathname
const templatesDir = join(baseDir, '..', 'templates')

// ensure template dir is present
await mkdir(templatesDir, { recursive: true })

const templateOverlayDir = join(baseDir, '..', 'template-overlay')
for (const templateType in templateConfig) {
  const templateSource = join(baseDir, '..', '..', templateConfig[templateType])
  const templateTarget = join(templatesDir, `template-${templateType}`)
  copyTemplateOverlayFiles(templateSource, templateTarget, templateOverlayDir)
}
